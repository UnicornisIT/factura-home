import { beforeEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import superjson from "superjson";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../api/router";
import app from "../api/boot";
import { resetDb } from "./helpers";
import { ensureOwner, changeAccess } from "../api/queries/admin-allowlist";
import { createCollection } from "../api/queries/collections";
import { createProduct, updateProduct } from "../api/queries/products";
import { securitySql } from "../api/queries/security-store";
import { consumeRateLimit } from "../api/lib/rate-limit";
import { getSessionCookieOptions } from "../api/lib/cookies";

const origin = "http://localhost:3000";
function signed(
  id: number,
  auth_date = Math.floor(Date.now() / 1000),
  token = "test-only-bot-token"
) {
  const data = { id, auth_date };
  const check = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key as keyof typeof data]}`)
    .join("\n");
  return {
    ...data,
    hash: createHmac("sha256", createHash("sha256").update(token).digest())
      .update(check)
      .digest("hex"),
  };
}
function browser(initialCookie = "", requestOrigin = origin) {
  let cookie = initialCookie;
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: origin + "/api/trpc",
        transformer: superjson,
        fetch: async (url, options) => {
          const headers = new Headers(options?.headers);
          headers.set("origin", requestOrigin);
          if (cookie) headers.set("cookie", cookie);
          const response = await app.request(String(url), {
            ...options,
            headers,
          } as RequestInit);
          const next = response.headers.get("set-cookie");
          if (next) cookie = next.split(";")[0];
          return response;
        },
      }),
    ],
  });
  return { client, cookie: () => cookie };
}
beforeEach(async () => {
  resetDb();
  await ensureOwner();
});
describe("HTTP security and checkout", () => {
  it("allows signed owner/admin, denies strangers and tampered, expired, future and wrong-bot logins", async () => {
    const owner = browser();
    await owner.client.auth.telegram.verify.mutate(signed(100));
    expect((await owner.client.auth.me.query())?.role).toBe("super_admin");
    await owner.client.allowlist.add.mutate({ telegramId: 200 });
    const admin = browser();
    await admin.client.auth.telegram.verify.mutate(signed(200));
    expect(await admin.client.products.listAll.query()).toEqual([]);
    await expect(admin.client.allowlist.list.query()).rejects.toThrow();
    await expect(
      admin.client.allowlist.add.mutate({ telegramId: 300 })
    ).rejects.toThrow();
    await expect(
      browser().client.auth.telegram.verify.mutate(signed(999))
    ).rejects.toThrow("Доступ запрещён");
    for (const data of [
      signed(100, 1),
      signed(100, Math.floor(Date.now() / 1000) + 300),
      signed(100, undefined, "wrong-bot"),
      { ...signed(100), id: 555 },
    ]) {
      await expect(
        browser().client.auth.telegram.verify.mutate(data)
      ).rejects.toThrow();
    }
    expect(await browser().client.auth.telegram.widgetConfig.query()).toEqual({
      botName: "test_bot",
    });
  });
  it("rejects repeated login payloads and revoked/logged-out cookies", async () => {
    await changeAccess(100, 200, "add");
    const admin = browser();
    await admin.client.auth.telegram.verify.mutate(signed(200));
    await expect(
      browser().client.auth.telegram.verify.mutate(signed(200))
    ).rejects.toThrow();
    const oldCookie = admin.cookie();
    await admin.client.auth.logout.mutate();
    expect(await browser(oldCookie).client.auth.me.query()).toBeNull();
    await admin.client.auth.telegram.verify.mutate(
      signed(200, Math.floor(Date.now() / 1000) - 1)
    );
    const second = admin.cookie();
    await changeAccess(100, 200, "deactivate");
    await expect(
      browser(second).client.products.listAll.query()
    ).rejects.toThrow();
    await changeAccess(100, 200, "add");
    expect(await browser(second).client.auth.me.query()).toBeNull();
  });
  it("rejects anonymous protected API calls and has no test or old auth routes", async () => {
    const paths = [
      "products.listAll",
      "orders.list",
      "allowlist.list",
      "allowlist.audit",
    ];
    for (const path of paths) {
      const response = await app.request(`${origin}/api/trpc/${path}`);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    for (const path of ["auth.telegram.devLogin", "auth.local.login"]) {
      const response = await app.request(`${origin}/api/trpc/${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(404);
    }
    expect((await app.request(`${origin}/api/oauth/callback`)).status).toBe(
      404
    );
    expect(
      (
        await app.request(`${origin}/api/log`, {
          method: "POST",
          headers: { origin },
        })
      ).status
    ).toBe(404);
  });
  it("blocks cross-origin and missing-origin mutations, upload and logout", async () => {
    const admin = browser();
    await admin.client.auth.telegram.verify.mutate(signed(100));
    await expect(
      browser(
        admin.cookie(),
        "https://evil.example"
      ).client.auth.logout.mutate()
    ).rejects.toThrow();
    for (const path of [
      "/api/upload",
      "/api/trpc/auth.logout",
      "/api/trpc/orders.create",
    ]) {
      for (const headers of [{}, { origin: "https://evil.example" }])
        expect(
          (await app.request(origin + path, { method: "POST", headers })).status
        ).toBe(403);
    }
    expect(getSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
  });
  it("recomputes checkout totals and shows new orders to administrators", async () => {
    const collection = await createCollection({ slug: "test", title: "Test" });
    const product = await createProduct({
      collectionId: collection.id,
      name: "Ваза",
      price: 700,
    });
    const guest = browser();
    const saved = await guest.client.orders.create.mutate({
      name: "Иван",
      contact: "@ivan",
      items: [{ productId: product.id, qty: 2, price: 1, name: "Fake" }],
      total: 1,
    } as never);
    expect(saved.total).toBe(1400);
    expect(JSON.parse(saved.items)[0].name).toBe("Ваза");
    const owner = browser();
    await owner.client.auth.telegram.verify.mutate(signed(100));
    expect((await owner.client.orders.list.query())[0].id).toBe(saved.id);
    for (const item of [
      { productId: 999, qty: 1 },
      { productId: product.id, qty: 0 },
      { productId: product.id, qty: 51 },
    ])
      await expect(
        guest.client.orders.create.mutate({
          name: "X",
          contact: "x",
          items: [item],
        })
      ).rejects.toThrow();
    await updateProduct(product.id, { isActive: false });
    await expect(
      guest.client.orders.create.mutate({
        name: "X",
        contact: "x",
        items: [{ productId: product.id, qty: 1 }],
      })
    ).rejects.toThrow();
  });
  it("uploads decoded raster images for both roles and rejects fake files, SVG and revoked sessions", async () => {
    const owner = browser();
    await owner.client.auth.telegram.verify.mutate(signed(100));
    await changeAccess(100, 200, "add");
    const admin = browser();
    await admin.client.auth.telegram.verify.mutate(signed(200));
    const upload = (
      cookie: string,
      bytes: Uint8Array,
      filename = "photo.png"
    ) => {
      const form = new FormData();
      form.append(
        "file",
        new File([bytes as BlobPart], filename, { type: "image/png" })
      );
      return app.request(origin + "/api/upload", {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      });
    };
    for (const actor of [owner, admin]) {
      for (const format of ["png", "jpeg", "webp"] as const) {
        const bytes = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "red" },
        })
          .toFormat(format)
          .toBuffer();
        const response = await upload(actor.cookie(), bytes);
        expect(response.status).toBe(200);
        const { url } = (await response.json()) as { url: string };
        const image = await app.request(origin + url);
        expect(image.status).toBe(200);
        expect(image.headers.get("content-type")).toBe("image/webp");
      }
    }
    for (const text of [
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      "not an image",
    ])
      expect((await upload(owner.cookie(), Buffer.from(text))).status).toBe(
        400
      );
    expect((await upload("", Buffer.from("x"))).status).toBe(401);
    await changeAccess(100, 200, "deactivate");
    expect((await upload(admin.cookie(), Buffer.from("x"))).status).toBe(401);
  });
  it("enforces durable rate and body-size limits", async () => {
    expect(await consumeRateLimit("test-bucket", 1, 60000)).toBe(true);
    expect(await consumeRateLimit("test-bucket", 1, 60000)).toBe(false);
    expect(
      (
        await app.request(origin + "/api/trpc/orders.create", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "x".repeat(6 * 1024 * 1024 + 1),
        })
      ).status
    ).toBe(413);
    expect(
      (await securitySql("SELECT * FROM apiRateLimits")).length
    ).toBeGreaterThan(0);
  });
});

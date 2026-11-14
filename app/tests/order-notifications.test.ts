import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../api/router";
import { __getSqliteClient } from "../api/queries/connection";
import { createCollection } from "../api/queries/collections";
import { createProduct } from "../api/queries/products";
import { changeAccess } from "../api/queries/admin-allowlist";
import {
  createOrder,
  listOrders,
  updateOrderStatus,
} from "../api/queries/orders";
import { securitySql } from "../api/queries/security-store";
import {
  claimOrderNotification,
  deliveryLeaseMs,
  finishOrderNotification,
  maxDeliveryAttempts,
} from "../api/queries/order-notifications";
import { deliverNextOrderNotification } from "../api/lib/order-telegram";
import { addAllowlistEntry, resetDb } from "./helpers";

vi.mock("../api/lib/env", async importOriginal => {
  const actual = await importOriginal<typeof import("../api/lib/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      publicOrigin: "https://shop.example",
      telegramBotName: "shop_bot",
      telegramBotToken: "test-token",
      superAdminTelegramId: 100,
    },
  };
});

const callAs = (telegramId: number, role = "admin") =>
  appRouter.createCaller({
    req: new Request("https://shop.example"),
    resHeaders: new Headers(),
    user: { authMethod: "telegram", telegramId, role },
  }).orderNotifications;

const send = vi.fn<typeof fetch>();
const ok = () => Response.json({ ok: true });
const checkout = () =>
  createOrder({
    name: "<b>Покупатель</b>",
    contact: "@contact",
    comment: "Комментарий покупателя",
    items: [{ productId: 1, qty: 2 }],
  });
const deliveries = () =>
  securitySql("SELECT * FROM orderTelegramOutbox ORDER BY id");
const requestBody = (index = 0) =>
  JSON.parse(String(send.mock.calls[index][1]?.body));

async function subscribe(telegramId = 100) {
  const settings = callAs(telegramId);
  await settings.setEnabled({ enabled: true });
  send.mockClear();
}

beforeEach(async () => {
  resetDb();
  vi.stubGlobal(
    "fetch",
    send.mockReset().mockImplementation(async () => ok())
  );
  await addAllowlistEntry({ telegramId: 100, role: "super_admin" });
  const collection = await createCollection({ slug: "sale", title: "Sale" });
  await createProduct({
    collectionId: collection.id,
    name: "Ваза",
    price: 700,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("order Telegram notifications", () => {
  it("sends saved order details to each subscribed administrator once", async () => {
    await addAllowlistEntry({ telegramId: 200 });
    await addAllowlistEntry({ telegramId: 300 });
    await addAllowlistEntry({ telegramId: 400, isActive: false });
    await subscribe(100);
    await subscribe(200);
    const order = await checkout();
    expect(send).not.toHaveBeenCalled();
    await listOrders();
    await updateOrderStatus(order.id, "done");
    expect(await deliverNextOrderNotification()).toBe(true);
    expect(await deliverNextOrderNotification()).toBe(true);
    expect(await deliverNextOrderNotification()).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect([requestBody().chat_id, requestBody(1).chat_id].sort()).toEqual([
      100, 200,
    ]);
    expect(requestBody().text).toContain(`Новый заказ #${order.id}`);
    expect(requestBody().text).toContain("<b>Покупатель</b>");
    expect(requestBody().text).toContain("@contact");
    expect(requestBody().text).toContain("Ваза × 2 — 700 ₽/шт.");
    expect(requestBody().text).toMatch(/Итого: 1\s400 ₽/);
    expect(requestBody().text).toContain("Комментарий покупателя");
    expect(requestBody().parse_mode).toBeUndefined();
    expect(requestBody().reply_markup.inline_keyboard).toEqual([
      [{ text: "Открыть заказ", url: "https://shop.example/admin/orders" }],
    ]);
    expect((await deliveries()).map(row => row.status)).toEqual([
      "sent",
      "sent",
    ]);
  });

  it("requires self-service and a working private chat before enabling", async () => {
    const settings = callAs(100, "super_admin");
    await expect(
      settings.setEnabled({ enabled: true, telegramId: 999 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(callAs(999).test()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    send.mockResolvedValueOnce(
      Response.json(
        { ok: false, description: "Bad Request: chat not found" },
        { status: 400 }
      )
    );
    await expect(settings.setEnabled({ enabled: true })).rejects.toThrow(
      "/start"
    );
    expect(await settings.settings()).toEqual({
      enabled: false,
      configured: true,
      botUrl: "https://t.me/shop_bot",
    });
    expect(requestBody().chat_id).toBe(100);
    await expect(settings.test()).resolves.toEqual({ sent: true });
    expect((await settings.settings()).enabled).toBe(false);
  });

  it("cancels queued deliveries following opt-out or deactivation, even after re-enabling", async () => {
    await changeAccess(100, 200, "add");
    await subscribe(100);
    await subscribe(200);
    await checkout();
    await callAs(100).setEnabled({ enabled: false });
    await changeAccess(100, 200, "deactivate");
    await expect(callAs(200).settings()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await checkout();
    await subscribe(100);
    await changeAccess(100, 200, "add");
    expect((await callAs(200).settings()).enabled).toBe(false);
    await deliverNextOrderNotification();
    await deliverNextOrderNotification();
    expect(send).not.toHaveBeenCalled();
    expect((await deliveries()).map(row => row.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });

  it("keeps the saved order when Telegram is down and honours retry_after", async () => {
    await subscribe();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    send.mockRejectedValueOnce(new Error("network timeout"));
    send.mockResolvedValueOnce(
      Response.json(
        { ok: false, parameters: { retry_after: 90 } },
        { status: 429 }
      )
    );
    const order = await checkout();
    expect(await listOrders()).toEqual([order]);
    await deliverNextOrderNotification();
    const [first] = await deliveries();
    expect(first).toMatchObject({ attempts: 1, status: "pending" });
    expect(await deliverNextOrderNotification()).toBe(false);
    clock.mockReturnValue(Number(first.availableAt));
    await deliverNextOrderNotification();
    const [second] = await deliveries();
    expect(second.availableAt).toBe(Number(first.availableAt) + 90_000);
    clock.mockReturnValue(Number(second.availableAt));
    await deliverNextOrderNotification();
    expect((await deliveries())[0]).toMatchObject({
      attempts: 3,
      status: "sent",
    });
  });

  it("claims once concurrently and can reclaim an expired lease", async () => {
    await subscribe();
    await checkout();
    const now = Date.now();
    const claims = await Promise.all([
      claimOrderNotification(now),
      claimOrderNotification(now),
    ]);
    const [original] = claims.filter(claim => claim !== undefined);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      await claimOrderNotification(now + deliveryLeaseMs - 1)
    ).toBeUndefined();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + deliveryLeaseMs);
    await deliverNextOrderNotification();
    await finishOrderNotification(original, "failed");
    expect((await deliveries())[0]).toMatchObject({
      attempts: 2,
      status: "sent",
    });
    clock.mockReturnValue(now + 2 * deliveryLeaseMs);
    expect(await deliverNextOrderNotification()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("terminates retries after the attempt limit and does not retry a blocked bot", async () => {
    await subscribe();
    await checkout();
    await checkout();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    send.mockImplementation(async () =>
      Response.json({ ok: false }, { status: 503 })
    );
    send.mockResolvedValueOnce(Response.json({ ok: false }, { status: 403 }));
    await deliverNextOrderNotification();
    for (let i = 0; i < maxDeliveryAttempts; i++) {
      clock.mockReturnValue(now + 1_000_000 * i);
      await deliverNextOrderNotification();
    }
    expect(await deliverNextOrderNotification()).toBe(false);
    expect(
      (await deliveries()).map(({ status, attempts }) => [status, attempts])
    ).toEqual([
      ["failed", 1],
      ["failed", maxDeliveryAttempts],
    ]);
  });

  it("does not queue invalid orders and rolls back checkout when enqueue fails", async () => {
    await subscribe();
    await expect(
      createOrder({
        name: "Test",
        contact: "Test",
        items: [{ productId: 999, qty: 1 }],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await deliveries()).toEqual([]);
    __getSqliteClient().exec(
      "CREATE TRIGGER reject_delivery BEFORE INSERT ON orderTelegramOutbox BEGIN SELECT RAISE(ABORT, 'test rollback'); END;"
    );
    await expect(checkout()).rejects.toThrow("test rollback");
    expect(await listOrders()).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("fits 50 lengthy positions and keeps the summary in Telegram's limit", async () => {
    await subscribe();
    for (let i = 0; i < 49; i++)
      await createProduct({
        collectionId: 1,
        name: "🏺".repeat(127),
        price: 700,
      });
    await createOrder({
      name: "Имя",
      contact: "@contact",
      comment: "🏺".repeat(1000),
      items: Array.from({ length: 50 }, (_, i) => ({
        productId: i + 1,
        qty: 1,
      })),
    });
    await deliverNextOrderNotification();
    const message = requestBody().text as string;
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message.match(/ × 1 /g)).toHaveLength(50);
    expect(message).toMatch(/Итого: 35\s000 ₽/);
    expect(message).toContain("Комментарий:");
    expect(message).toBe(message.toWellFormed());
  });
});

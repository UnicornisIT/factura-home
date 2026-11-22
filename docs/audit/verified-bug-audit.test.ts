// Copy into app/tests in an isolated checkout of the audited SHA, then run Vitest.
import { createHash, createHmac } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { resetDb, seedSiteContent } from "./helpers";
import { __getSqliteClient } from "../api/queries/connection";
import { ensureOwner } from "../api/queries/admin-allowlist";
import app from "../api/boot";

const origin = "http://localhost:3000";

function loginPayload() {
  const id = 100;
  const auth_date = Math.floor(Date.now() / 1000);
  const secret = createHash("sha256").update("test-only-bot-token").digest();
  const hash = createHmac("sha256", secret)
    .update(`auth_date=${auth_date}\nid=${id}`)
    .digest("hex");
  return { id, auth_date, hash };
}

function post(
  procedure: string,
  json: unknown,
  cookie?: string,
  ip = "192.0.2.1"
) {
  return app.request(
    origin + "/api/trpc/" + procedure,
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": ip,
        ...(cookie && { cookie }),
      },
      body: JSON.stringify({ json }),
    },
    { incoming: { socket: { remoteAddress: "127.0.0.1" } } } as never
  );
}

beforeEach(async () => {
  resetDb();
  await ensureOwner();
});

it("BE-1: HTTP 500 follows a committed admin update when audit INSERT fails", async () => {
  await seedSiteContent();
  const login = await post("auth.telegram.verify", loginPayload());
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const db = __getSqliteClient();
  db.exec(`CREATE TRIGGER audit_fault BEFORE INSERT ON adminAuditLog
    BEGIN SELECT RAISE(ABORT, 'test audit write failure'); END`);
  const response = await post(
    "content.update",
    { heroTitle: "Committed title" },
    cookie
  );
  expect(response.status).toBe(500);
  expect(db.prepare("SELECT heroTitle FROM siteContent").get()).toEqual({
    heroTitle: "Committed title",
  });
});

it("BE-3: ten requests from one forwarded IP deny a second IP behind the proxy", async () => {
  const invalid = { ...loginPayload(), hash: "0".repeat(64) };
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await post("auth.telegram.verify", invalid)).status).toBe(401);
  }
  const victim = await post(
    "auth.telegram.verify",
    loginPayload(),
    undefined,
    "192.0.2.2"
  );
  expect(victim.status).toBe(429);
});

it("N-2: unknown GET procedures consume the shared checkout and login budget", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await app.request(
      origin + "/api/trpc/unknown.orders.create",
      { headers: { "x-real-ip": "192.0.2.1" } },
      { incoming: { socket: { remoteAddress: "127.0.0.1" } } } as never
    );
    expect(response.status).toBe(404);
  }
  const response = await post(
    "auth.telegram.verify",
    loginPayload(),
    undefined,
    "192.0.2.2"
  );
  expect(response.status).toBe(429);
});

it("BE-26: encoded batch separators avoid the Hono operation count", async () => {
  const procedures = Array.from({ length: 21 }, () => "ping");
  const url = origin + "/api/trpc/";
  const literal = await app.request(url + procedures.join(",") + "?batch=1");
  const encoded = await app.request(url + procedures.join("%2C") + "?batch=1");
  expect(literal.status).toBe(400);
  expect(encoded.status).toBe(200);
  expect(await encoded.json()).toHaveLength(21);
});

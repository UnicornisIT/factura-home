import { beforeEach, expect, it, vi } from "vitest";
import app from "../api/boot";
import { resetDb } from "./helpers";

vi.mock("../api/lib/env", async importOriginal => {
  const original = await importOriginal<typeof import("../api/lib/env")>();
  return { ...original, env: { ...original.env, trustedProxyIp: "127.0.0.1" } };
});

const origin = "http://localhost:3000";
const login = "auth.telegram.verify";
const invalidLogin = {
  id: 100,
  auth_date: Math.floor(Date.now() / 1000),
  hash: "0".repeat(64),
};

function request(
  procedure: string,
  forwardedIp = "192.0.2.1",
  peer = "::ffff:127.0.0.1",
  options: RequestInit = {}
) {
  return app.request(
    origin + "/api/trpc/" + procedure,
    {
      method: "POST",
      body: JSON.stringify({ json: invalidLogin }),
      ...options,
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": forwardedIp,
      },
    },
    { incoming: { socket: { remoteAddress: peer } } } as never
  );
}

beforeEach(resetDb);

it("limits each proxied client and each sensitive procedure independently", async () => {
  for (let attempt = 0; attempt < 10; attempt++)
    expect((await request(login)).status).toBe(401);

  expect((await request(login)).status).toBe(429);
  expect((await request(login, "192.0.2.2")).status).toBe(401);
  expect((await request("orders.create")).status).toBe(400);
});

it("ignores direct spoofing and rejects a list of forwarded IP addresses", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    expect(
      (await request(login, `192.0.2.${attempt + 1}`, "198.51.100.1")).status
    ).toBe(401);
    expect(
      (await request(login, `192.0.2.${attempt + 1}, 198.51.100.1`)).status
    ).toBe(401);
  }

  expect((await request(login, "192.0.2.50", "198.51.100.1")).status).toBe(429);
  expect((await request(login, "192.0.2.50, 198.51.100.1")).status).toBe(429);
  expect((await request(login, "192.0.2.50")).status).toBe(401);
});

it("does not charge the login quota for GETs or unknown routes", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await request("unknown.orders.create")).status).toBe(404);
    expect(
      (
        await request(login, undefined, undefined, {
          method: "GET",
          body: undefined,
        })
      ).status
    ).toBe(405);
  }
  expect((await request(login)).status).toBe(401);
});

it("counts each mutation in a batch and enforces the operation limit after decoding", async () => {
  const mutations = Array.from({ length: 10 }, () => login);
  const entries = mutations.map((_, index) => [index, { json: invalidLogin }]);
  const batch = await request(
    mutations.join("%2C") + "?batch=1",
    undefined,
    undefined,
    {
      body: JSON.stringify(Object.fromEntries(entries)),
    }
  );
  expect(batch.status).toBe(401);
  expect(await batch.json()).toHaveLength(10);
  expect((await request(login)).status).toBe(429);

  const queries = Array.from({ length: 21 }, () => "ping");
  for (const separator of [",", "%2C"]) {
    const response = await request(
      queries.join(separator) + "?batch=1",
      undefined,
      undefined,
      {
        method: "GET",
        body: undefined,
      }
    );
    expect(response.status).toBe(400);
  }
});

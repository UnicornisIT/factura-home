import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
const config = {
  ...process.env,
  NODE_ENV: "production",
  DB_DIALECT: "sqlite",
  SQLITE_PATH: ":memory:",
  PUBLIC_ORIGIN: "https://shop.example.com",
  APP_SECRET: "test-only-secret-with-at-least-32-characters",
  TELEGRAM_BOT_TOKEN: "test-only-bot-token",
  TELEGRAM_BOT_NAME: "test_bot",
  SUPER_ADMIN_TELEGRAM_ID: "100",
};
function run(source: string, overrides = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    { env: { ...config, ...overrides }, encoding: "utf8", timeout: 30000 }
  );
}
describe("production configuration", () => {
  it("has no local or simulated login procedures and uses secure cookies independent of Host", () => {
    const result = run(`
      import { appRouter } from './api/router.ts';
      import { getSessionCookieOptions } from './api/lib/cookies.ts';
      import assert from 'node:assert/strict';
      assert.equal(appRouter._def.procedures['auth.telegram.devLogin'], undefined);
      assert.equal(appRouter._def.procedures['auth.local.login'], undefined);
      assert.equal(getSessionCookieOptions().secure, true);
      assert.equal(getSessionCookieOptions().sameSite, 'Lax');
    `);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 60000);
  it("fails closed for missing or unsafe production configuration", () => {
    for (const overrides of [
      { APP_SECRET: "short" },
      { PUBLIC_ORIGIN: "http://shop.example.com" },
      { TELEGRAM_BOT_TOKEN: "" },
      { SUPER_ADMIN_TELEGRAM_ID: "" },
      { SUPER_ADMIN_TELEGRAM_ID: "9007199254740992" },
      { DEV_ADMIN_ORIGIN: "http://localhost:3001" },
      { UPLOAD_DIR: "./dist/uploads" },
    ]) {
      expect(
        run("await import('./api/lib/env.ts')", overrides).status
      ).not.toBe(0);
    }
  }, 60000);
});

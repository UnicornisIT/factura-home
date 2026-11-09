import { afterAll } from "vitest";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
const uploads = resolve(join(tmpdir(), `factura-tests-${process.pid}`));
process.env.UPLOAD_DIR = uploads;
afterAll(() => {
  if (
    !uploads.startsWith(resolve(tmpdir()) + "\\") &&
    !uploads.startsWith(resolve(tmpdir()) + "/")
  )
    throw new Error("Unexpected temporary directory");
  rmSync(uploads, { recursive: true, force: true });
});
process.env.NODE_ENV = "test";
process.env.DB_DIALECT = "sqlite";
process.env.SQLITE_PATH = ":memory:";
process.env.APP_SECRET = "test-only-secret-with-at-least-32-characters";
process.env.PUBLIC_ORIGIN = "http://localhost:3000";
process.env.TELEGRAM_BOT_TOKEN = "test-only-bot-token";
process.env.TELEGRAM_BOT_NAME = "test_bot";
process.env.SUPER_ADMIN_TELEGRAM_ID = "100";

import { isAbsolute, relative, resolve, sep } from "node:path";
import "dotenv/config";
const isProduction = process.env.NODE_ENV === "production";
export const dbDialect =
  process.env.DB_DIALECT === "sqlite" || process.env.NODE_ENV === "test"
    ? "sqlite"
    : "mysql";
export const sqlitePath =
  process.env.SQLITE_PATH ??
  (process.env.NODE_ENV === "test" ? ":memory:" : "./dev.db");
const owner = Number(process.env.SUPER_ADMIN_TELEGRAM_ID || 0);
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
if (
  process.env.DB_DIALECT &&
  !["sqlite", "mysql"].includes(process.env.DB_DIALECT)
)
  throw new Error("Invalid DB_DIALECT");
if (
  process.env.SUPER_ADMIN_TELEGRAM_ID &&
  (!Number.isSafeInteger(owner) || owner <= 0)
)
  throw new Error("Invalid SUPER_ADMIN_TELEGRAM_ID");
if (new URL(origin).origin !== origin)
  throw new Error("PUBLIC_ORIGIN must be an origin without a trailing slash");
if (isProduction) {
  for (const name of [
    "APP_SECRET",
    "PUBLIC_ORIGIN",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_NAME",
    "SUPER_ADMIN_TELEGRAM_ID",
    "UPLOAD_DIR",
    ...(dbDialect === "mysql" ? ["DATABASE_URL"] : []),
  ]) {
    if (!process.env[name])
      throw new Error(`Missing required environment variable: ${name}`);
  }
  if ((process.env.APP_SECRET?.length ?? 0) < 32)
    throw new Error("APP_SECRET must have at least 32 characters");
  if (!origin.startsWith("https://"))
    throw new Error("Production requires an HTTPS PUBLIC_ORIGIN");
  if (!isAbsolute(process.env.UPLOAD_DIR || ""))
    throw new Error(
      "Production UPLOAD_DIR must be an absolute persistent path"
    );
  const uploadRelativeToBuild = relative(
    resolve("dist"),
    resolve(process.env.UPLOAD_DIR || "")
  );
  if (
    uploadRelativeToBuild === "" ||
    (!isAbsolute(uploadRelativeToBuild) &&
      uploadRelativeToBuild !== ".." &&
      !uploadRelativeToBuild.startsWith(".." + sep))
  )
    throw new Error("UPLOAD_DIR must be outside dist");
  if (process.env.DEV_ADMIN_ORIGIN)
    throw new Error("DEV_ADMIN_ORIGIN is forbidden in production");
}
export const env = {
  isProduction,
  dbDialect,
  sqlitePath,
  appSecret: process.env.APP_SECRET || "test-only-secret",
  databaseUrl: process.env.DATABASE_URL || "",
  publicOrigin: origin,
  devAdminOrigin: !isProduction ? process.env.DEV_ADMIN_ORIGIN : undefined,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramBotName: process.env.TELEGRAM_BOT_NAME || "",
  superAdminTelegramId: owner,
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
} as const;

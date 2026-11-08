import { readFileSync } from "node:fs";
export const DDL = readFileSync(
  new URL("./migrations/001_initial.sqlite.sql", import.meta.url),
  "utf8"
);

export function createSqliteTables(client: import("better-sqlite3").Database) {
  client.exec(DDL);
}

export function clearSqliteTables(client: import("better-sqlite3").Database) {
  // Dependent rows must be removed before their parent collections.
  for (const t of [
    "adminSessions",
    "telegramAuthReplay",
    "adminAuditLog",
    "apiRateLimits",
    "products",
    "orders",
    "collections",
    "siteContent",
    "adminAllowlist",
  ]) {
    client.exec(`DELETE FROM ${t};`);
  }
  // Сбросить AUTOINCREMENT, чтобы id снова начинались с 1 —
  // тесты часто ожидают детерминированные id.
  client.exec("DELETE FROM sqlite_sequence;");
}

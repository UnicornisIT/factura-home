import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./migrations/", import.meta.url);

// DDL для тестов — все применённые SQLite-миграции по порядку.
export const DDL = readdirSync(directory)
  .filter(name => name.endsWith(".sqlite.sql"))
  .sort()
  .map(name => readFileSync(new URL(name, directory), "utf8"))
  .join("\n");

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
    "blocks",
    "adminAllowlist",
  ]) {
    client.exec(`DELETE FROM ${t};`);
  }
  // Сбросить AUTOINCREMENT, чтобы id снова начинались с 1 —
  // тесты часто ожидают детерминированные id.
  client.exec("DELETE FROM sqlite_sequence;");
}

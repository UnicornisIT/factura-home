/**
 * Хелперы для тестов.
 *
 *  • `resetDb()` — пересоздаёт таблицы в SQLite и сбрасывает синглтон getDb().
 *    Используется в `beforeEach` чтобы каждый it начинался с чистой базы.
 *
 *  • `seedSiteContent()` — вставляет строку siteContent, иначе
 *    api/queries/content.getSiteContent кидает "Site content not seeded".
 *
 */
import {
  __resetDbForTests,
  __getSqliteClient,
  getDb,
} from "../api/queries/connection";
import { createSqliteTables, clearSqliteTables } from "../db/sqlite-ddl";
import { siteContent, adminAllowlist } from "@db/schema";

export function resetDb() {
  __resetDbForTests();
  getDb();
  const client = __getSqliteClient();
  createSqliteTables(client);
}

export function clearRows() {
  const client = __getSqliteClient();
  clearSqliteTables(client);
}

export async function seedSiteContent() {
  const db = getDb();
  await db.insert(siteContent).values({
    heroText: "test hero text",
    aboutText: "test about",
    deliveryText: "test delivery",
  });
}

/**
 * Добавляет telegramId в allowlist напрямую через БД (минуя tRPC).
 * Полезно для настройки предусловий в тестах router'ов.
 */
export async function addAllowlistEntry(data: {
  telegramId: number;
  role?: "admin" | "super_admin";
  addedByTelegramId?: number | null;
  isActive?: boolean;
}) {
  const db = getDb();
  // Тесты всегда на SQLite, поэтому используем .returning() напрямую
  // (MySQL-only $returningId тут не подойдёт).
  const rows: any[] = await db
    .insert(adminAllowlist)
    .values({
      telegramId: data.telegramId,
      role: data.role ?? "admin",
      addedByTelegramId: data.addedByTelegramId ?? null,
      isActive: data.isActive ?? true,
    })
    .returning();
  if (!rows[0]) throw new Error("Failed to add allowlist entry");
  return rows[0];
}

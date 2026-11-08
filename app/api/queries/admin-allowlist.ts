import { TRPCError } from "@trpc/server";

import { env } from "../lib/env";

import {
  securitySql,
  securityTransaction,
  audit,
  type Sql,
} from "./security-store";

import type { AdminAllowlistEntry } from "@db/schema";

export type AllowlistRole = "super_admin" | "admin";

function entry(row: Record<string, unknown>): AdminAllowlistEntry {
  return {
    ...row,
    isActive: !!row.isActive,
    addedAt:
      row.addedAt instanceof Date
        ? row.addedAt
        : new Date(Number(row.addedAt) * 1000),
  } as AdminAllowlistEntry;
}

export async function findActiveByTelegramId(id: number) {
  const [row] = await securitySql(
    "SELECT * FROM adminAllowlist WHERE telegramId = ? AND isActive = 1",
    [id]
  );

  return row ? entry(row) : undefined;
}

export async function listAllowlist() {
  return (await securitySql("SELECT * FROM adminAllowlist ORDER BY id")).map(
    entry
  );
}

export async function bootstrapOwner(sql: Sql) {
  if (!env.superAdminTelegramId) return;

  const upsert =
    env.dbDialect === "sqlite"
      ? "INSERT INTO adminAllowlist (telegramId, role, isActive) VALUES (?, 'super_admin', 1) ON CONFLICT(telegramId) DO UPDATE SET role = 'super_admin', isActive = 1"
      : "INSERT INTO adminAllowlist (telegramId, role, isActive) VALUES (?, 'super_admin', 1) ON DUPLICATE KEY UPDATE role = 'super_admin', isActive = 1";
  await sql(upsert, [env.superAdminTelegramId]);
}

export async function ensureOwner() {
  await securityTransaction(bootstrapOwner);
}

export async function changeAccess(
  actor: number,
  id: number,
  operation: "add" | "deactivate" | "role",
  role: AllowlistRole = "admin"
) {
  const result = await securityTransaction(async sql => {
    // The protected owner's row is the shared lock for all access changes across server processes.

    const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";

    const [owner] = await sql(
      `SELECT id FROM adminAllowlist WHERE telegramId = ? AND role = 'super_admin' AND isActive = 1${lock}`,
      [env.superAdminTelegramId]
    );
    if (!owner)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Требуется настройка владельца",
      });

    const [caller] = await sql(
      "SELECT * FROM adminAllowlist WHERE telegramId = ? AND isActive = 1",
      [actor]
    );

    const [target] = await sql(
      "SELECT * FROM adminAllowlist WHERE telegramId = ?",
      [id]
    );

    let denied = "";

    if (caller?.role !== "super_admin") denied = "Доступ запрещён";
    else if (id === env.superAdminTelegramId)
      denied = "Права владельца защищены";
    else if (id === actor && (operation === "deactivate" || role === "admin"))
      denied = "Нельзя отозвать собственные права";
    else if (operation !== "add" && !target) denied = "Запись не найдена";
    else if (operation === "role" && !target?.isActive)
      denied = "Запись неактивна";

    if (denied) {
      await audit(
        sql,
        actor,
        `access.${operation}`,
        id,
        (target?.role as string) ?? null,
        role,
        "denied"
      );

      return { denied };
    }

    const before = (target?.role as string) ?? null;

    if (operation === "add" && !target) {
      await sql(
        "INSERT INTO adminAllowlist (telegramId, role, isActive, addedByTelegramId) VALUES (?, ?, 1, ?)",
        [id, role, actor]
      );
    } else {
      await sql(
        "UPDATE adminAllowlist SET role = ?, isActive = ? WHERE telegramId = ?",
        [
          operation === "deactivate" ? before! : role,
          operation === "deactivate" ? 0 : 1,
          id,
        ]
      );
    }

    // Reactivation must never make a previously issued session valid again.

    await sql("DELETE FROM adminSessions WHERE telegramId = ?", [id]);

    await audit(
      sql,
      actor,
      `access.${operation}`,
      id,
      before,
      operation === "deactivate" ? null : role
    );

    return { denied: "" };
  });

  if (result.denied)
    throw new TRPCError({ code: "FORBIDDEN", message: result.denied });

  return findActiveByTelegramId(id);
}

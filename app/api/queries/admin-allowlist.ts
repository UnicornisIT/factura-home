import { TRPCError } from "@trpc/server";

import { env } from "../lib/env";
import { cancelUpdateDeliveriesSql } from "./update-notifications";

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

async function insertAdmin(
  sql: Sql,
  id: number,
  role: AllowlistRole,
  actor: number
) {
  await sql(
    "INSERT INTO adminAllowlist (telegramId, role, isActive, addedByTelegramId) VALUES (?, ?, 1, ?)",
    [id, role, actor]
  );
}

export async function addInitialAdmins(ids: number[]) {
  const owner = env.superAdminTelegramId;
  if (!owner) throw new Error("SUPER_ADMIN_TELEGRAM_ID is required");
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id === owner))
    throw new Error("Expected positive Telegram IDs distinct from the owner");
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate Telegram IDs");

  return securityTransaction(async sql => {
    // The owner's row serializes writes with access changes from the panel.
    const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";
    const [configuredOwner] = await sql(
      `SELECT id FROM adminAllowlist WHERE telegramId = ? AND role = 'super_admin' AND isActive = 1${lock}`,
      [owner]
    );
    if (!configuredOwner)
      throw new Error("Run migrations to initialize the owner");

    let added = 0;
    const preserved: number[] = [];
    for (const id of ids) {
      const [existing] = await sql(
        "SELECT id FROM adminAllowlist WHERE telegramId = ?",
        [id]
      );
      // Preserve roles and revocations if setup is retried against the same DB.
      if (existing) {
        preserved.push(id);
        continue;
      }
      await insertAdmin(sql, id, "admin", owner);
      await audit(sql, owner, "access.add", id, null, "admin");
      const [created] = await sql(
        "SELECT id FROM adminAllowlist WHERE telegramId = ? AND role = 'admin' AND isActive = 1 AND addedByTelegramId = ?",
        [id, owner]
      );
      if (!created) throw new Error("Could not verify administrator access");
      added++;
    }
    return { added, preserved };
  });
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
      await insertAdmin(sql, id, role, actor);
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

    if (operation === "deactivate") {
      await sql("DELETE FROM orderTelegramSubscriptions WHERE telegramId = ?", [
        id,
      ]);
      await sql(
        "DELETE FROM updateTelegramSubscriptions WHERE telegramId = ?",
        [id]
      );
      await sql(cancelUpdateDeliveriesSql, [id]);
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

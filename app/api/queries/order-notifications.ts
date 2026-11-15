import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "../lib/env";
import {
  securitySql,
  withSqliteTransactionLock,
  type Sql,
} from "./security-store";

// Do not let the worker observe writes from an uncommitted SQLite transaction.
const notificationSql: Sql = (...args) =>
  env.dbDialect === "sqlite"
    ? withSqliteTransactionLock(() => securitySql(...args))
    : securitySql(...args);

const eligibleAdmin = "a.isActive = 1 AND a.role IN ('admin', 'super_admin')";
export const maxDeliveryAttempts = 6;
export const deliveryLeaseMs = 60_000;

export function enqueueOrderNotifications(orderId: number) {
  return sql`INSERT INTO orderTelegramOutbox (orderId, telegramId, subscriptionKey)
    SELECT ${orderId}, a.telegramId, s.subscriptionKey
    FROM orderTelegramSubscriptions s
    JOIN adminAllowlist a ON a.telegramId = s.telegramId
    WHERE ${sql.raw(eligibleAdmin)}`;
}

export async function notificationPreference(telegramId: number) {
  const [row] = await notificationSql(
    `SELECT s.subscriptionKey FROM adminAllowlist a
     LEFT JOIN orderTelegramSubscriptions s ON s.telegramId = a.telegramId
     WHERE a.telegramId = ? AND ${eligibleAdmin}`,
    [telegramId]
  );
  return row ? Boolean(row.subscriptionKey) : undefined;
}

export type Delivery = {
  id: number;
  attempts: number;
  claimToken: string;
  leaseUntil: number;
};

export async function claimOrderNotification(
  now: number
): Promise<Delivery | undefined> {
  await notificationSql(
    `UPDATE orderTelegramOutbox SET status = 'failed', claimToken = NULL
     WHERE status = 'pending' AND availableAt <= ? AND attempts >= ?`,
    [now, maxDeliveryAttempts]
  );
  const [candidate] = await notificationSql(
    `SELECT id FROM orderTelegramOutbox
     WHERE status = 'pending' AND availableAt <= ? AND attempts < ?
     ORDER BY availableAt, id LIMIT 1`,
    [now, maxDeliveryAttempts]
  );
  if (!candidate) return;
  const id = Number(candidate.id);
  const claimToken = randomUUID();
  await notificationSql(
    `UPDATE orderTelegramOutbox SET claimToken = ?, attempts = attempts + 1, availableAt = ?
     WHERE id = ? AND status = 'pending' AND availableAt <= ? AND attempts < ?`,
    [claimToken, now + deliveryLeaseMs, id, now, maxDeliveryAttempts]
  );
  const [claimed] = await notificationSql(
    "SELECT attempts FROM orderTelegramOutbox WHERE id = ? AND claimToken = ?",
    [id, claimToken]
  );
  if (claimed)
    return {
      id,
      claimToken,
      attempts: Number(claimed.attempts),
      leaseUntil: now + deliveryLeaseMs,
    };
}

export async function readEligibleDelivery(delivery: Delivery, now: number) {
  const [row] = await notificationSql(
    `SELECT o.id, o.name, o.contact, o.comment, o.items, o.total, q.telegramId
     FROM orderTelegramOutbox q
     JOIN orders o ON o.id = q.orderId
     JOIN adminAllowlist a ON a.telegramId = q.telegramId
     JOIN orderTelegramSubscriptions s ON s.telegramId = q.telegramId AND s.subscriptionKey = q.subscriptionKey
     WHERE q.id = ? AND q.claimToken = ? AND q.availableAt > ? AND ${eligibleAdmin}`,
    [delivery.id, delivery.claimToken, now]
  );
  return (
    row && {
      id: Number(row.id),
      name: String(row.name),
      contact: String(row.contact),
      comment: row.comment === null ? null : String(row.comment),
      items: String(row.items),
      total: Number(row.total),
      telegramId: Number(row.telegramId),
    }
  );
}

export async function finishOrderNotification(
  delivery: Delivery,
  status: "sent" | "failed" | "cancelled" | "pending",
  availableAt = 0
) {
  await notificationSql(
    "UPDATE orderTelegramOutbox SET status = ?, availableAt = ?, claimToken = NULL WHERE id = ? AND claimToken = ?",
    [status, availableAt, delivery.id, delivery.claimToken]
  );
}

import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  UpdateEventKind,
  UpdateRollback,
} from "@contracts/update-notifications";
import { env } from "../lib/env";
import {
  eligibleAdmin,
  notificationSql,
  type Delivery,
} from "./order-notifications";
import { runSqlTransaction, type SqlTransaction } from "./security-store";

const day = 86_400_000;
const eventLifetime = 180 * day;
const historyPageSize = 20;
const updateEventPageSize = 20;
const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";

function ignoreConflict(keys: string, column: string) {
  return env.dbDialect === "mysql"
    ? `ON DUPLICATE KEY UPDATE ${column} = VALUES(${column})`
    : `ON CONFLICT(${keys}) DO NOTHING`;
}

type Row = Record<string, unknown>;
const optionalText = (value: unknown) =>
  typeof value === "string" ? value : null;

function publicEvent(row: Row) {
  return {
    id: Number(row.id),
    kind: row.kind as UpdateEventKind,
    createdAt: Number(row.createdAt),
    version: optionalText(row.version),
    rollback: row.rollback as UpdateRollback | null,
    releaseUrl: optionalText(row.releaseUrl),
    releaseSummary: optionalText(row.releaseSummary),
  };
}

type Event = Pick<
  ReturnType<typeof publicEvent>,
  "kind" | "createdAt" | "version"
> & {
  key: string;
  operationId?: string;
  rollback?: UpdateRollback | null;
  releaseUrl?: string | null;
  releaseSummary?: string;
  releaseNotes?: string;
  publishedAt?: string | null;
};

function* insertEvent(event: Event, notify: boolean): SqlTransaction<boolean> {
  // Callers serialize on the release monitor or the operation row.
  const key = createHash("sha256").update(event.key).digest("hex");
  const [previous] = yield [
    "SELECT id FROM updateEvents WHERE eventKey = ?",
    [key],
  ];
  if (previous) return false;
  yield [
    `INSERT INTO updateEvents (eventKey, kind, createdAt, version, operationId,
      rollback, releaseUrl, releaseNotes, releaseSummary, publishedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key,
      event.kind,
      event.createdAt,
      event.version,
      event.operationId ?? null,
      event.rollback ?? null,
      event.releaseUrl ?? null,
      event.releaseNotes ?? null,
      event.releaseSummary ?? null,
      event.publishedAt ?? null,
    ],
  ];
  if (notify) {
    yield [
      `INSERT INTO updateTelegramOutbox (eventId, telegramId, subscriptionKey, availableAt)
       SELECT e.id, a.telegramId, s.subscriptionKey, ?
       FROM updateEvents e CROSS JOIN updateTelegramSubscriptions s
       JOIN adminAllowlist a ON a.telegramId = s.telegramId
       WHERE e.eventKey = ? AND ${eligibleAdmin}`,
      [Date.now(), key],
    ];
  }
  return true;
}

export function observeRelease(
  repository: string,
  release: Omit<Event, "key" | "kind" | "createdAt"> | null,
  now: number
) {
  return runSqlTransaction(function* () {
    yield [
      `INSERT INTO updateReleaseMonitor (repository, initializedAt)
       VALUES (?, ?) ${ignoreConflict("repository", "repository")}`,
      [repository, now],
    ];
    const [monitor] = yield [
      "SELECT initializedAt FROM updateReleaseMonitor WHERE repository = ?" +
        lock,
      [repository],
    ];
    if (!release?.version) return false;
    return yield* insertEvent(
      {
        ...release,
        key: JSON.stringify(["release", repository, release.version]),
        kind: "update_available",
        createdAt: now,
      },
      Date.parse(release.publishedAt ?? "") > Number(monitor.initializedAt)
    );
  });
}

export async function recordUpdateRequest(operationId: string, actor: number) {
  const now = Date.now();
  await notificationSql(
    `INSERT INTO updateOperations (operationId, initiatedBy, source, startedAt, updatedAt)
     VALUES (?, ?, 'panel', ?, ?)`,
    [operationId, actor, now, now]
  );
}

export type UpdateSnapshot = {
  operationId: string;
  state: "running" | "success" | "failed" | "unconfirmed";
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  fromVersion: string | null;
  targetVersion: string | null;
  rollback: UpdateRollback | null;
  source: "panel" | "manual" | "unknown";
  diagnostic: string | null;
};

export function saveUpdateSnapshot(snapshot: UpdateSnapshot, now: number) {
  return runSqlTransaction(function* () {
    const {
      operationId,
      state,
      startedAt,
      updatedAt,
      finishedAt,
      fromVersion,
      targetVersion,
      rollback,
      source,
      diagnostic,
    } = snapshot;
    yield [
      `INSERT INTO updateOperations (operationId, startedAt, updatedAt)
       VALUES (?, ?, ?) ${ignoreConflict("operationId", "operationId")}`,
      [operationId, startedAt, updatedAt],
    ];
    const [existing] = yield [
      "SELECT state, source, updatedAt FROM updateOperations WHERE operationId = ?" +
        lock,
      [operationId],
    ];
    if (
      existing.state === "success" ||
      existing.state === "failed" ||
      (existing.state === "unconfirmed" &&
        (state === "unconfirmed" || state === "running")) ||
      (existing.state === "running" &&
        (state === "running" || state === "unconfirmed") &&
        Number(existing.updatedAt) > updatedAt)
    )
      return;
    yield [
      `UPDATE updateOperations SET source = ?, state = ?, startedAt = ?, updatedAt = ?,
       finishedAt = ?, fromVersion = ?, targetVersion = ?, rollback = ?, diagnostic = ?
       WHERE operationId = ?`,
      [
        existing.source === "panel"
          ? "panel"
          : source === "manual"
            ? "manual"
            : "unknown",
        state,
        startedAt,
        updatedAt,
        finishedAt,
        fromVersion,
        targetVersion,
        rollback,
        diagnostic,
        operationId,
      ],
    ];

    // Wait for release lookup so the start notification can name the target
    // even when the entire operation completed while the app was offline.
    if (targetVersion || state !== "running") {
      const notify = source !== "unknown" && startedAt >= now - 7 * day;
      yield* insertEvent(
        {
          key: JSON.stringify([operationId, "update_started"]),
          kind: "update_started",
          operationId,
          version: targetVersion,
          createdAt: startedAt,
        },
        notify
      );
    }
    if (state === "success" || state === "failed") {
      const kind = state === "success" ? "update_success" : "update_failed";
      const createdAt = finishedAt ?? updatedAt;
      yield* insertEvent(
        {
          key: JSON.stringify([operationId, kind]),
          kind,
          operationId,
          version: targetVersion,
          createdAt,
          rollback,
        },
        source !== "unknown" && createdAt >= now - 7 * day
      );
    }
  });
}

export async function staleUpdateOperations(
  now: number
): Promise<UpdateSnapshot[]> {
  const rows = await notificationSql(
    "SELECT * FROM updateOperations WHERE state = 'running' AND updatedAt <= ?",
    [now - 2 * 60 * 60_000]
  );
  return rows.map(row => ({
    operationId: String(row.operationId),
    state: "unconfirmed",
    startedAt: Number(row.startedAt),
    updatedAt: Number(row.updatedAt),
    finishedAt: null,
    fromVersion: optionalText(row.fromVersion),
    targetVersion: optionalText(row.targetVersion),
    rollback: row.rollback as UpdateRollback | null,
    source: row.source as UpdateSnapshot["source"],
    diagnostic: "Время ожидания истекло. Итог установки не подтверждён.",
  }));
}

export async function updateHistory(page: number) {
  const rows = await notificationSql(
    `SELECT * FROM updateOperations WHERE state <> 'requested'
     ORDER BY startedAt DESC, operationId DESC LIMIT ? OFFSET ?`,
    [historyPageSize + 1, page * historyPageSize]
  );
  return {
    hasNext: rows.length > historyPageSize,
    items: rows.slice(0, historyPageSize).map(row => ({
      operationId: String(row.operationId),
      initiatedBy: row.initiatedBy === null ? null : Number(row.initiatedBy),
      source: row.source as UpdateSnapshot["source"],
      state: row.state as UpdateSnapshot["state"],
      startedAt: Number(row.startedAt),
      finishedAt: row.finishedAt === null ? null : Number(row.finishedAt),
      fromVersion: optionalText(row.fromVersion),
      targetVersion: optionalText(row.targetVersion),
      rollback: row.rollback as UpdateRollback | null,
      diagnostic: optionalText(row.diagnostic),
    })),
  };
}

export async function updateInbox(telegramId: number, page: number) {
  const since = Date.now() - eventLifetime;
  const join =
    "FROM updateEvents e LEFT JOIN updateEventReads r ON r.eventId = e.id AND r.telegramId = ?";
  const [rows, [count]] = await Promise.all([
    notificationSql(
      `SELECT e.id, e.kind, e.createdAt, e.version, e.rollback, e.releaseUrl,
       e.releaseSummary, r.eventId IS NOT NULL AS isRead ${join}
       WHERE e.createdAt >= ? ORDER BY e.createdAt DESC, e.id DESC LIMIT ? OFFSET ?`,
      [telegramId, since, updateEventPageSize + 1, page * updateEventPageSize]
    ),
    notificationSql(
      `SELECT COUNT(*) AS unread ${join} WHERE e.createdAt >= ? AND r.eventId IS NULL`,
      [telegramId, since]
    ),
  ]);
  return {
    unread: Number(count.unread),
    hasNext: rows.length > updateEventPageSize,
    items: rows.slice(0, updateEventPageSize).map(row => ({
      ...publicEvent(row),
      isRead: Boolean(row.isRead),
    })),
  };
}

export async function markUpdateRead(telegramId: number, eventId?: number) {
  await notificationSql(
    `INSERT INTO updateEventReads (telegramId, eventId)
     SELECT ?, e.id FROM updateEvents e WHERE e.createdAt >= ? ${eventId === undefined ? "" : "AND e.id = ?"}
     ${ignoreConflict("telegramId, eventId", "eventId")}`,
    eventId === undefined
      ? [telegramId, Date.now() - eventLifetime]
      : [telegramId, Date.now() - eventLifetime, eventId]
  );
}

export async function updateTelegramPreference(telegramId: number) {
  const [row] = await notificationSql(
    `SELECT s.subscriptionKey FROM adminAllowlist a
     LEFT JOIN updateTelegramSubscriptions s ON s.telegramId = a.telegramId
     WHERE a.telegramId = ? AND ${eligibleAdmin}`,
    [telegramId]
  );
  if (!row)
    throw new TRPCError({ code: "FORBIDDEN", message: "Доступ запрещён" });
  return Boolean(row.subscriptionKey);
}

export function changeUpdateTelegramPreference(
  telegramId: number,
  enabled: boolean
) {
  return runSqlTransaction(function* () {
    const [admin] = yield [
      `SELECT a.id FROM adminAllowlist a WHERE a.telegramId = ? AND ${eligibleAdmin}${lock}`,
      [telegramId],
    ];
    if (!admin)
      throw new TRPCError({ code: "FORBIDDEN", message: "Доступ запрещён" });
    if (enabled) {
      yield [
        `INSERT INTO updateTelegramSubscriptions (telegramId, subscriptionKey)
         VALUES (?, ?) ${ignoreConflict("telegramId", "telegramId")}`,
        [telegramId, randomUUID()],
      ];
    } else {
      yield [
        "DELETE FROM updateTelegramSubscriptions WHERE telegramId = ?",
        [telegramId],
      ];
      yield [cancelUpdateDeliveriesSql, [telegramId]];
    }
  });
}

export const cancelUpdateDeliveriesSql =
  "UPDATE updateTelegramOutbox SET status = 'cancelled', claimToken = NULL WHERE telegramId = ? AND status = 'pending'";

export async function readEligibleUpdateDelivery(
  delivery: Delivery,
  deadline: number
) {
  const [row] = await notificationSql(
    `SELECT e.*, q.telegramId FROM updateTelegramOutbox q
     JOIN updateEvents e ON e.id = q.eventId
     JOIN adminAllowlist a ON a.telegramId = q.telegramId
     JOIN updateTelegramSubscriptions s ON s.telegramId = q.telegramId AND s.subscriptionKey = q.subscriptionKey
     WHERE q.id = ? AND q.claimToken = ? AND q.status = 'pending'
     AND q.availableAt > ? AND ${eligibleAdmin}`,
    [delivery.id, delivery.claimToken, deadline]
  );
  return (
    row && {
      ...publicEvent(row),
      telegramId: Number(row.telegramId),
      operationId: optionalText(row.operationId),
      releaseNotes: optionalText(row.releaseNotes),
    }
  );
}

export function pruneUpdateNotifications(now: number) {
  return runSqlTransaction(function* () {
    const expires = now - eventLifetime;
    yield [
      `DELETE FROM updateTelegramOutbox WHERE eventId IN
      (SELECT id FROM updateEvents WHERE createdAt < ?)`,
      [expires],
    ];
    yield [
      `DELETE FROM updateEventReads WHERE eventId IN
      (SELECT id FROM updateEvents WHERE createdAt < ?)`,
      [expires],
    ];
    // Keep event keys as deduplication records if a release resurfaces.
    yield [
      `UPDATE updateEvents SET releaseNotes = NULL, releaseSummary = NULL
      WHERE createdAt < ? AND (releaseNotes IS NOT NULL OR releaseSummary IS NOT NULL)`,
      [expires],
    ];
    yield [
      "DELETE FROM updateOperations WHERE state = 'requested' AND startedAt < ?",
      [now - 7 * day],
    ];
  });
}

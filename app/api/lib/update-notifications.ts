import {
  updateEventDescription,
  updateEventTitles,
} from "@contracts/update-notifications";
import {
  observeRelease,
  pruneUpdateNotifications,
  readEligibleUpdateDelivery,
  saveUpdateSnapshot,
  staleUpdateOperations,
  type UpdateSnapshot,
} from "../queries/update-notifications";
import {
  claimTelegramDelivery,
  finishTelegramDelivery,
  maxDeliveryAttempts,
} from "../queries/order-notifications";
import { env } from "./env";
import { log } from "./logger";
import {
  sendTelegramMessage,
  telegramRetryDelay,
  telegramTimeoutMs,
} from "./order-telegram";
import { escapeTelegram, releaseExcerpt } from "./release-markdown";
import {
  compareStableRelease,
  fetchLatestRelease,
  isUpdateRunning,
  pruneUpdateSnapshot,
  readCurrentVersion,
  readUpdateJournal,
  readUpdateStatus,
  updateOperationIdPattern,
  type UpdateOperationStatus,
} from "./system-update";

const day = 86_400_000;
const outbox = "updateTelegramOutbox";
const diagnosis = new Map(
  Object.entries({
    "проверка окружения": "Не пройдена проверка окружения.",
    "проверка доступа к GitHub":
      "Проверка доступа к GitHub завершилась ошибкой.",
    "загрузка информации о релизе":
      "Не удалось получить сведения о релизе или его архив.",
    "создание резервных копий": "Не удалось подготовить резервные копии.",
    "получение исходного кода": "Не удалось получить исходный код релиза.",
    "установка зависимостей": "Не удалось установить зависимости.",
    "сборка приложения и админ-панели": "Не удалось собрать приложение.",
    "проверка deployment-файлов": "Не пройдена проверка файлов развёртывания.",
    "миграция базы данных": "Не удалось применить миграции базы данных.",
    "установка deployment-файлов": "Не удалось установить файлы развёртывания.",
    "перезапуск сервиса": "Не удалось перезапустить магазин.",
    "проверка работоспособности":
      "Проверка работоспособности магазина не пройдена.",
  })
);

function safeVersion(value: string | null | undefined) {
  return value &&
    /^(?:v?\d+\.\d+\.\d+(?:[.+-][\da-z.-]+)?|[0-9a-f]{7,40})$/i.test(value) &&
    value.length <= 128
    ? value
    : null;
}

export async function checkForNewRelease(now = Date.now()) {
  const repository = env.serverUpdateRepository.toLowerCase();
  await observeRelease(repository, null, now);
  let release;
  try {
    release = await fetchLatestRelease();
  } catch {
    log.warn("Update release check failed");
    return false;
  }
  const comparison =
    release && compareStableRelease(release.tag, await readCurrentVersion());
  if (!release || comparison !== 1) return false;
  const notes = (release.notes ?? "").slice(0, 125_000);
  return observeRelease(
    repository,
    {
      version: release.tag,
      releaseUrl: release.url,
      publishedAt: Number.isFinite(Date.parse(release.publishedAt ?? ""))
        ? new Date(release.publishedAt!).toISOString()
        : null,
      releaseNotes: notes,
      releaseSummary: releaseExcerpt(notes, 500),
    },
    now
  );
}

function normalizeSnapshot(
  status: UpdateOperationStatus,
  now: number
): UpdateSnapshot | null {
  const { operationId } = status;
  const startedAt = Date.parse(status.startedAt ?? "");
  const finishedAt = Date.parse(status.finishedAt ?? "");
  if (
    !operationId ||
    !updateOperationIdPattern.test(operationId) ||
    !Number.isFinite(startedAt) ||
    status.message === "already up to date"
  )
    return null;
  const progressAt = Date.parse(status.updatedAt ?? "");
  const updatedAt = Number.isFinite(progressAt) ? progressAt : startedAt;
  const state =
    status.state === "running" && !isUpdateRunning(status, now)
      ? "unconfirmed"
      : status.state;
  if (state === "success" && !Number.isFinite(finishedAt)) return null;
  let rollback = status.rollback ?? null;
  if (status.state === "failed" && status.rollback === undefined) {
    const message = status.message ?? "";
    if (message.includes("сервис работоспособен, БД не откатывалась"))
      rollback = "restored";
    else if (
      message.includes("rollback failed") ||
      message.includes("но сервис не поднялся")
    )
      rollback = "failed";
  }
  return {
    operationId,
    state,
    startedAt,
    updatedAt,
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : null,
    fromVersion: safeVersion(
      status.fromVersion ??
        (status.state === "success"
          ? /^updated from (.+)$/.exec(status.message ?? "")?.[1]
          : undefined)
    ),
    targetVersion: safeVersion(
      status.targetVersion === undefined ? status.tag : status.targetVersion
    ),
    rollback,
    source: status.source ?? "unknown",
    diagnostic:
      state === "unconfirmed"
        ? "Время ожидания истекло. Итог установки не подтверждён."
        : state === "failed"
          ? (diagnosis.get(status.stage ?? "") ??
            "Установка прервана. Подробности в журнале обновления.")
          : null,
  };
}

export async function reconcileUpdateJournal(path?: string, now = Date.now()) {
  const snapshots = await readUpdateJournal(path);
  const latest = await readUpdateStatus(path);
  if (
    latest &&
    !snapshots.some(({ status }) => status.operationId === latest.operationId)
  )
    snapshots.push({ status: latest, path: "" });
  snapshots.sort(
    (a, b) =>
      Date.parse(a.status.startedAt ?? "") -
      Date.parse(b.status.startedAt ?? "")
  );
  for (const { status, path: snapshotPath } of snapshots) {
    const snapshot = normalizeSnapshot(status, now);
    if (!snapshot) continue;
    await saveUpdateSnapshot(snapshot, now);
    if (snapshotPath && snapshot.finishedAt && snapshot.finishedAt < now - day)
      await pruneUpdateSnapshot(snapshotPath);
  }
  for (const snapshot of await staleUpdateOperations(now))
    await saveUpdateSnapshot(snapshot, now);
}

export async function deliverNextUpdateNotification() {
  if (!env.telegramBotToken) return false;
  const delivery = await claimTelegramDelivery(outbox, Date.now());
  if (!delivery) return false;
  const deadline = () => Date.now() + telegramTimeoutMs;
  const canSend = () => deadline() < delivery.leaseUntil;
  const event = await readEligibleUpdateDelivery(delivery, deadline());
  if (!event) {
    if (canSend()) await finishTelegramDelivery(outbox, delivery, "cancelled");
    return true;
  }
  const isRelease = event.kind === "update_available";
  const title = `${isRelease ? "🚀 " : ""}Factura Home — ${updateEventTitles[event.kind]}`;
  const details = [
    updateEventDescription(event),
    new Date(event.createdAt).toLocaleString("ru-RU", {
      timeZoneName: "short",
    }),
    event.operationId && `Операция ${event.operationId}`,
  ]
    .filter(Boolean)
    .join("\n");
  const button = isRelease
    ? event.releaseUrl
      ? { text: "Посмотреть релиз", url: event.releaseUrl }
      : undefined
    : {
        text: "Открыть админ-панель",
        url: new URL("/admin/", env.publicOrigin).href,
      };
  const notes =
    event.releaseNotes && releaseExcerpt(event.releaseNotes, 3000, true);
  const message = `<b>${escapeTelegram(title)}</b>\n${escapeTelegram(details)}${notes ? "\n\nЧто изменилось\n" + notes : ""}`;
  // Formatting can take time. Recheck the lease and subscription at dispatch.
  if (!canSend()) return true;
  if (!(await readEligibleUpdateDelivery(delivery, deadline()))) {
    if (canSend()) await finishTelegramDelivery(outbox, delivery, "cancelled");
    return true;
  }
  if (!canSend()) return true;
  let result = await sendTelegramMessage(event.telegramId, message, {
    html: true,
    button,
  });
  if (
    result.kind === "rejected" &&
    notes &&
    canSend() &&
    (await readEligibleUpdateDelivery(delivery, deadline())) &&
    canSend()
  ) {
    const summary = event.releaseSummary
      ? "\n\nЧто изменилось\n" + event.releaseSummary
      : "";
    result = await sendTelegramMessage(
      event.telegramId,
      title + "\n" + details + summary,
      { button }
    );
  }
  if (result.kind === "retry" && delivery.attempts < maxDeliveryAttempts) {
    await finishTelegramDelivery(
      outbox,
      delivery,
      "pending",
      Date.now() + telegramRetryDelay(delivery.attempts, result.retryAfterMs)
    );
  } else {
    await finishTelegramDelivery(
      outbox,
      delivery,
      result.kind === "sent" ? "sent" : "failed"
    );
    if (result.kind !== "sent")
      log.warn("Update notification failed", { reason: result.kind });
  }
  return true;
}

export function startUpdateNotificationWorkers() {
  const run = (
    task: () => Promise<unknown>,
    interval: number,
    error: string
  ) => {
    const poll = async () => {
      let delay = interval;
      try {
        if ((await task()) === true && task === deliverNextUpdateNotification)
          delay = 100;
      } catch {
        log.error(error);
      } finally {
        setTimeout(() => void poll(), delay).unref();
      }
    };
    void poll();
  };
  run(
    () => checkForNewRelease(),
    30 * 60_000,
    "Could not record update release"
  );
  run(
    () => reconcileUpdateJournal(),
    5000,
    "Could not reconcile update journal"
  );
  run(
    () => pruneUpdateNotifications(Date.now()),
    day,
    "Could not prune update notifications"
  );
  if (env.telegramBotToken)
    run(
      deliverNextUpdateNotification,
      2000,
      "Update notification worker failed"
    );
}

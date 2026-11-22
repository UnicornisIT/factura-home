import { spawn } from "node:child_process";
import { access, constants, readFile, readdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { TRPCError } from "@trpc/server";
import { env } from "./env";
import { log } from "./logger";
import type { UpdateRollback } from "@contracts/update-notifications";
import { publicReleaseUrl } from "./release-markdown";

export type LatestRelease = {
  tag: string;
  name: string | null;
  publishedAt: string | null;
  notes: string | null;
  url: string | null;
};

export type UpdateOperationStatus = {
  state: "running" | "success" | "failed";
  tag: string | null;
  stage: string | null;
  operationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  fromVersion?: string | null;
  targetVersion?: string | null;
  updatedAt?: string | null;
  rollback?: UpdateRollback | null;
  source?: "panel" | "manual";
};

const RELEASE_CACHE_TTL_MS = 60_000;
// Защита от залипшего "running", если скрипт обновления погиб без записи статуса.
const RUNNING_TIMEOUT_MS = 30 * 60_000;
// Окно подтверждения запуска: за это время sudo/скрипт либо отклоняют запуск
// (мгновенный ненулевой код), либо скрипт передаёт обновление в transient unit
// и выходит с кодом 0, либо обновление продолжается на месте.
const LAUNCH_CONFIRM_MS = 15_000;
const STDERR_LIMIT = 4_096;
let releaseCache: {
  key: string;
  at: number;
  value: LatestRelease | null;
} | null = null;
export const updateOperationIdPattern = /^[A-Za-z0-9-]{1,64}$/;

export function __resetReleaseCacheForTests() {
  releaseCache = null;
}

// Встраивается esbuild: смена checkout не меняет версию работающего процесса.
declare const FACTURA_BUILD_VERSION: string | undefined;

export async function readCurrentVersion(): Promise<string | null> {
  return typeof FACTURA_BUILD_VERSION === "string"
    ? FACTURA_BUILD_VERSION
    : null;
}

export async function fetchLatestRelease(
  repository = env.serverUpdateRepository,
  token = env.githubToken
): Promise<LatestRelease | null> {
  const key = repository + ":" + token;
  if (
    releaseCache?.key === key &&
    Date.now() - releaseCache.at < RELEASE_CACHE_TTL_MS
  )
    return releaseCache.value;
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "factura-shop",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );
  } catch {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "GitHub API недоступен (сетевая ошибка)",
    });
  }
  if (response.status === 404) {
    // GitHub отвечает 404 и когда релизов нет, и когда приватный репозиторий
    // недоступен с текущими учётными данными.
    releaseCache = { key, at: Date.now(), value: null };
    return null;
  }
  if (response.status === 401)
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message:
        "GitHub API ответил 401: GITHUB_TOKEN недействителен или отозван",
    });
  if (response.status === 403 || response.status === 429)
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `GitHub API ответил ${response.status}: недостаточно прав у токена или превышен лимит запросов`,
    });
  if (!response.ok)
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `GitHub API ответил ${response.status}`,
    });
  const data = (await response.json()) as {
    tag_name?: unknown;
    name?: unknown;
    published_at?: unknown;
    body?: unknown;
    html_url?: unknown;
    prerelease?: unknown;
    draft?: unknown;
  };
  if (data.prerelease === true || data.draft === true) return null;
  if (
    typeof data.tag_name !== "string" ||
    !data.tag_name ||
    data.tag_name.length > 128
  )
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "GitHub API вернул релиз без тега",
    });
  const value: LatestRelease = {
    tag: data.tag_name,
    name: typeof data.name === "string" ? data.name : null,
    publishedAt:
      typeof data.published_at === "string" ? data.published_at : null,
    notes: typeof data.body === "string" ? data.body : null,
    url: publicReleaseUrl(
      typeof data.html_url === "string" ? data.html_url : null
    ),
  };
  releaseCache = { key, at: Date.now(), value };
  return value;
}

const versionPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function compareStableRelease(tag: string, installed: string | null) {
  const release = versionPattern.exec(tag);
  const current = versionPattern.exec(installed ?? "");
  if (
    !release ||
    release[4] ||
    !current ||
    current[4]
      ?.slice(1)
      .split(".")
      .some(part => /^0\d+$/.test(part))
  )
    return null;
  for (const index of [1, 2, 3]) {
    const left = BigInt(release[index]);
    const right = BigInt(current[index]);
    if (left !== right) return left > right ? 1 : -1;
  }
  return current[4] ? 1 : 0;
}

export async function readUpdateStatus(
  statusPath = env.serverUpdateStatusPath
): Promise<UpdateOperationStatus | null> {
  let raw: string;
  try {
    raw = await readFile(statusPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = parsed as Record<string, unknown> | null;
  if (
    !record ||
    !["running", "success", "failed"].includes(String(record.state))
  )
    return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    state: record.state as UpdateOperationStatus["state"],
    tag: text(record.tag),
    stage: text(record.stage),
    operationId: text(record.operationId),
    startedAt: text(record.startedAt),
    finishedAt: text(record.finishedAt),
    message: text(record.message),
    ...("fromVersion" in record && { fromVersion: text(record.fromVersion) }),
    ...("targetVersion" in record && {
      targetVersion: text(record.targetVersion),
    }),
    ...("updatedAt" in record && { updatedAt: text(record.updatedAt) }),
    ...("rollback" in record && {
      rollback:
        record.rollback === "restored" ||
        record.rollback === "failed" ||
        record.rollback === "in_progress"
          ? record.rollback
          : null,
    }),
    ...((record.source === "panel" || record.source === "manual") && {
      source: record.source,
    }),
  };
}

function journalPrefix(statusPath: string) {
  return `${basename(statusPath)}.operation-`;
}

export async function readUpdateJournal(
  statusPath = env.serverUpdateStatusPath
) {
  const directory = dirname(statusPath);
  const prefix = journalPrefix(statusPath);
  const files = await readdir(directory, { withFileTypes: true }).catch(
    error => {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  );
  const snapshots = [];
  for (const file of files) {
    const id = file.name.slice(prefix.length, -5);
    if (
      !file.isFile() ||
      !file.name.startsWith(prefix) ||
      !file.name.endsWith(".json") ||
      !updateOperationIdPattern.test(id)
    )
      continue;
    const path = join(directory, file.name);
    const status = await readUpdateStatus(path);
    if (status?.operationId === id) snapshots.push({ status, path });
  }
  return snapshots;
}

export async function pruneUpdateSnapshot(path: string) {
  await unlink(path).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
}

export function isUpdateRunning(
  status: UpdateOperationStatus | null,
  now = Date.now()
): boolean {
  if (status?.state !== "running") return false;
  const updatedAt = Date.parse(status.updatedAt ?? "");
  const startedAt = Date.parse(status.startedAt ?? "");
  return Number.isFinite(updatedAt)
    ? now - updatedAt < 4 * RUNNING_TIMEOUT_MS
    : !Number.isFinite(startedAt) || now - startedAt < RUNNING_TIMEOUT_MS;
}

type StartUpdateOptions = {
  enabled?: boolean;
  scriptPath?: string;
  statusPath?: string;
  launch?: (scriptPath: string) => void | Promise<void>;
  launchConfirmMs?: number;
  operationId?: string;
  beforeLaunch?: () => Promise<void>;
};

function sanitizeStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter(line => !/token|password|authorization/i.test(line))
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ")
    .slice(0, 300);
}

/**
 * Запускает скрипт обновления через `sudo -n` и подтверждает, что запуск
 * действительно принят: spawn-ошибка или быстрый ненулевой код (нет записи в
 * sudoers, скрипт отклонил запуск) превращаются в ошибку API, а не в ложное
 * `{ started: true }`. Выход с кодом 0 означает, что скрипт передал обновление
 * в transient unit systemd; если процесс ещё работает по истечении окна
 * подтверждения — обновление выполняется на месте. Дальнейший ход операции
 * отслеживается по статус-файлу, который пишет сам скрипт.
 */
export function launchUpdateScript(
  script: string,
  confirmMs = LAUNCH_CONFIRM_MS,
  operationId?: string
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stderr = "";
    const child = spawn(
      "sudo",
      ["-n", script, ...(operationId ? ["--request-id", operationId] : [])],
      {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: process.env,
      }
    );
    const timer = setTimeout(() => {
      settle(() => {
        child.unref();
        resolvePromise();
      });
    }, confirmMs);
    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }
    child.stderr?.on("data", chunk => {
      if (stderr.length < STDERR_LIMIT) stderr += String(chunk);
    });
    child.on("error", error => {
      log.error("Update script spawn failed", { type: error.name });
      settle(() =>
        rejectPromise(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Не удалось запустить обновление (${error.name}): проверьте наличие sudo и скрипта ${script}`,
          })
        )
      );
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        // Мгновенный выход 0: обновление передано в transient unit systemd.
        settle(() => {
          child.unref();
          resolvePromise();
        });
        return;
      }
      const detail = sanitizeStderr(stderr);
      settle(() =>
        rejectPromise(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Запуск обновления отклонён (код ${code ?? signal ?? "неизвестен"})${detail ? `: ${detail}` : ""}`,
          })
        )
      );
    });
  });
}

export async function startUpdate(
  options: StartUpdateOptions = {}
): Promise<{ started: true }> {
  const enabled = options.enabled ?? env.serverUpdateEnabled;
  const scriptPath = options.scriptPath ?? env.serverUpdateScript;
  const statusPath = options.statusPath ?? env.serverUpdateStatusPath;
  if (!enabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Обновление сервера не включено (SERVER_UPDATE_ENABLED)",
    });
  // Путь фиксирован конфигурацией: пользовательский ввод сюда не попадает.
  // Окружение скрипту не передаётся: sudoers его вырезает, корень установки
  // скрипт определяет сам (см. deployment/factura-update.sh).
  if (!isAbsolute(scriptPath))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SERVER_UPDATE_SCRIPT должен быть абсолютным путём",
    });
  try {
    await access(scriptPath, constants.X_OK);
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Скрипт обновления не найден или не является исполняемым",
    });
  }
  if (isUpdateRunning(await readUpdateStatus(statusPath)))
    throw new TRPCError({
      code: "CONFLICT",
      message: "Обновление уже выполняется",
    });
  const launch =
    options.launch ??
    ((script: string) =>
      launchUpdateScript(script, options.launchConfirmMs, options.operationId));
  await options.beforeLaunch?.();
  try {
    await launch(scriptPath);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Не удалось запустить обновление",
      cause: error,
    });
  }
  return { started: true };
}

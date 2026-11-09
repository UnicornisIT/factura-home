import { spawn } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { env } from "./env";
import { log } from "./logger";

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
  operationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
};

const RELEASE_CACHE_TTL_MS = 60_000;
// Защита от залипшего "running", если скрипт обновления погиб без записи статуса.
const RUNNING_TIMEOUT_MS = 30 * 60_000;
let releaseCache: { at: number; value: LatestRelease | null } | null = null;

export function __resetReleaseCacheForTests() {
  releaseCache = null;
}

export async function readCurrentVersion(): Promise<string | null> {
  // Сервер работает из app/, VERSION лежит в корне репозитория.
  for (const path of [resolve("..", "VERSION"), resolve("VERSION")]) {
    try {
      const version = (await readFile(path, "utf8")).trim();
      if (version) return version;
    } catch {
      // пробуем следующий путь
    }
  }
  return null;
}

export async function fetchLatestRelease(
  repository = env.serverUpdateRepository,
  token = env.serverUpdateToken
): Promise<LatestRelease | null> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_TTL_MS)
    return releaseCache.value;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "factura-shop",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  if (response.status === 404) {
    releaseCache = { at: Date.now(), value: null };
    return null;
  }
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
  };
  if (typeof data.tag_name !== "string" || !data.tag_name)
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
    url: typeof data.html_url === "string" ? data.html_url : null,
  };
  releaseCache = { at: Date.now(), value };
  return value;
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
    operationId: text(record.operationId),
    startedAt: text(record.startedAt),
    finishedAt: text(record.finishedAt),
    message: text(record.message),
  };
}

export function isUpdateRunning(status: UpdateOperationStatus | null): boolean {
  if (status?.state !== "running") return false;
  const startedAt = Date.parse(status.startedAt ?? "");
  return (
    !Number.isFinite(startedAt) || Date.now() - startedAt < RUNNING_TIMEOUT_MS
  );
}

type StartUpdateOptions = {
  enabled?: boolean;
  scriptPath?: string;
  statusPath?: string;
  launch?: (scriptPath: string) => void;
};

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
    ((script: string) => {
      // Скрипт сам пишет статус и журнал; здесь его вывод не нужен.
      const child = spawn("sudo", ["-n", script], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.on("error", error => {
        log.error("Update script spawn failed", { type: error.name });
      });
      child.unref();
    });
  launch(scriptPath);
  return { started: true };
}

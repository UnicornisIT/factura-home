import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { log } from "./lib/logger";
import { validMutationOrigin } from "./lib/csrf";
import { consumeRateLimit } from "./lib/rate-limit";
import { sanitizeImage } from "./lib/images";
import { audit, securitySql } from "./queries/security-store";
import { ensureOwner } from "./queries/admin-allowlist";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
const app = new Hono<{ Bindings: HttpBindings }>();
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  // Предпросмотр в админ-панели показывает витрину в iframe.
  // В production админка на том же origin — достаточно SAMEORIGIN;
  // в dev админка на :3001, поэтому рамку ограничиваем через CSP.
  if (env.isProduction) c.res.headers.set("X-Frame-Options", "SAMEORIGIN");
  else
    c.res.headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'self' http://localhost:3001"
    );
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/admin"))
    c.res.headers.set("Cache-Control", "no-store");
});
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !validMutationOrigin(c.req.raw)
  )
    return c.json({ error: "Forbidden origin" }, 403);
  if (c.req.path.startsWith("/api/trpc/") && c.req.path.split(",").length > 20)
    return c.json({ error: "Too many batched operations" }, 400);
  const ip = c.env?.incoming?.socket?.remoteAddress || "local";
  const sensitive =
    c.req.path.includes("orders.create") ||
    c.req.path.includes("telegram.verify");
  // Do not trust client-controlled forwarding headers for rate limits.
  if (
    !(await consumeRateLimit(
      `${sensitive ? "sensitive" : "api"}:${ip}`,
      sensitive ? 10 : 300,
      60000
    ))
  )
    return c.json({ error: "Too many requests" }, 429);
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 6 * 1024 * 1024,
    onError: c => c.json({ error: "Request too large" }, 413),
  })
);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

class OperationTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`${stage} timed out after ${ms}ms`);
    this.name = "OperationTimeoutError";
  }
}

// Нативную операцию Sharp/libvips отменить нельзя: после ответа по тайм-ауту
// она продолжает работать в пуле потоков до завершения, удерживая память
// (объём ограничен 5 МБ входа и limitInputPixels=16M). Это осознанный
// размен — иначе зависший декодер держал бы HTTP-запрос и соединение
// с nginx навсегда. Штатная обработка фотографий занимает <1 с, поэтому
// тайм-аут срабатывает только на патологических входных данных.
let sanitizeTimeoutMs = 15_000;
export function __setSanitizeTimeoutForTests(ms: number) {
  sanitizeTimeoutMs = ms;
}

function withTimeout<T>(promise: Promise<T>, stage: string, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OperationTimeoutError(stage, ms)),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

app.post("/api/upload", async c => {
  const startedAt = Date.now();
  const ctx = await createContext({
    req: c.req.raw,
    resHeaders: new Headers(),
    info: {} as never,
  });
  if (!ctx.user) return c.json({ error: "Unauthorized" }, 401);
  if (!["admin", "super_admin"].includes(ctx.user.role))
    return c.json({ error: "Доступ запрещён" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch (error) {
    log.warn("Upload failed", {
      stage: "parse-body",
      reason: errorName(error),
    });
    return c.json({ error: "Не удалось прочитать файл из запроса" }, 400);
  }
  const file = body.file;
  if (!(file instanceof File) || file.size === 0)
    return c.json({ error: "Select an image up to 5 MB" }, 400);
  if (file.size > MAX_UPLOAD_BYTES)
    return c.json({ error: "Файл больше 5 МБ" }, 413);

  let bytes: Buffer;
  try {
    bytes = await withTimeout(
      sanitizeImage(Buffer.from(await file.arrayBuffer())),
      "sanitize",
      sanitizeTimeoutMs
    );
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      log.error("Upload timed out", {
        stage: "sanitize",
        size: file.size,
        timeoutMs: sanitizeTimeoutMs,
      });
      return c.json({ error: "Сервер не смог обработать изображение" }, 500);
    }
    log.warn("Upload rejected", {
      stage: "sanitize",
      reason: errorName(error),
      size: file.size,
    });
    return c.json(
      { error: "Only valid JPEG, PNG and WebP images are allowed" },
      400
    );
  }

  const name = `${randomUUID()}.webp`;
  try {
    const dir = resolve(env.uploadDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes, { flag: "wx" });
  } catch (error) {
    // Категория ошибки ФС (EACCES/EROFS/ENOSPC/…) без путей и содержимого.
    log.error("Upload failed", {
      stage: "write",
      reason: errorCode(error) ?? errorName(error),
    });
    return c.json({ error: "Не удалось сохранить файл на сервере" }, 500);
  }

  try {
    await audit(
      securitySql,
      ctx.user.telegramId,
      "image.upload",
      null,
      null,
      null
    );
  } catch (error) {
    // Файл уже сохранён: сбой журнала не должен лишать клиента URL.
    // Потеря события не бывает незаметной — ошибка уходит в журнал
    // (stderr → journalctl) на уровне error с этапом и причиной.
    log.error("Upload succeeded but audit failed", {
      stage: "audit",
      reason: errorName(error),
    });
  }

  log.info("Upload completed", {
    size: file.size,
    outputBytes: bytes.byteLength,
    durationMs: Date.now() - startedAt,
  });
  return c.json({ url: `/uploads/${name}` });
});
app.get("/uploads/:name", async c => {
  const name = c.req.param("name");
  if (!/^[a-f0-9-]{36}\.webp$/.test(name)) return c.notFound();
  try {
    const bytes = await readFile(join(resolve(env.uploadDir), name));
    c.header("Content-Type", "image/webp");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(bytes);
  } catch {
    return c.notFound();
  }
});
app.use("/api/trpc/*", c =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
);
app.all("/api/*", c => c.json({ error: "Not Found" }, 404));
app.onError((error, c) => {
  log.error("Request failed", { type: error.name });
  return c.json({ error: "Internal Server Error" }, 500);
});
export default app;
if (env.isProduction && process.env.NODE_ENV !== "test") {
  await ensureOwner();
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  serve({
    fetch: app.fetch,
    port: Number(process.env.PORT || 3000),
    hostname: process.env.HOST || "127.0.0.1",
  });
}

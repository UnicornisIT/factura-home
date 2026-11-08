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
  c.res.headers.set("X-Frame-Options", "DENY");
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
app.post("/api/upload", async c => {
  const ctx = await createContext({
    req: c.req.raw,
    resHeaders: new Headers(),
    info: {} as never,
  });
  if (!ctx.user) return c.json({ error: "Unauthorized" }, 401);
  if (!["admin", "super_admin"].includes(ctx.user.role))
    return c.json({ error: "Доступ запрещён" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
    return c.json({ error: "Select an image up to 5 MB" }, 400);
  let bytes: Buffer;
  try {
    bytes = await sanitizeImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return c.json(
      { error: "Only valid JPEG, PNG and WebP images are allowed" },
      400
    );
  }
  const name = `${randomUUID()}.webp`;
  await mkdir(resolve(env.uploadDir), { recursive: true });
  await writeFile(join(resolve(env.uploadDir), name), bytes, { flag: "wx" });
  await audit(
    securitySql,
    ctx.user.telegramId,
    "image.upload",
    null,
    null,
    null
  );
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

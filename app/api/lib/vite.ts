import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/**
 * Отдаёт статические файлы и SPA-фолбэк сразу для двух сборок:
 *  • dist/public  — storefront (shop)
 *  • dist/admin   — отдельная админ-панель (отдельный Vite-app)
 *
 * В проде (NODE_ENV=production) один Node-процесс обслуживает и то,
 * и то, и API. В dev оба Vite-сервера запускаются отдельно
 * (`npm run dev` и `npm run dev:admin`).
 */
export function serveStaticFiles(app: App) {
  const publicDir = path.resolve(process.cwd(), "dist/public");
  const adminDir = path.resolve(process.cwd(), "dist/admin");

  // /admin → /admin/ (без trailing slash index.html удобнее отдать через
  // редирект, чтобы относительные пути в админском index.html считались
  // от /admin/, а не от корня домена).
  app.get("/admin", c => c.redirect("/admin/", 301));

  // Статика админ-панели: /admin/* → dist/admin/* (с rewrite, чтобы
  // serveStatic нашёл файл, например /admin/assets/index.js → /assets/index.js).
  app.use(
    "/admin/*",
    serveStatic({
      root: "./dist/admin",
      rewriteRequestPath: p => p.replace(/^\/admin/, "") || "/",
    })
  );

  // Статика магазина: всё остальное → dist/public/*
  app.use("*", serveStatic({ root: "./dist/public" }));

  // SPA-фолбэк: для любой "не-файловой" ссылки отдаём index.html
  // соответствующего приложения (admin для /admin/*, shop для остального).
  app.notFound(c => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }

    const reqPath = c.req.path;
    const isAdminPath = reqPath === "/admin" || reqPath.startsWith("/admin/");
    const indexPath = isAdminPath
      ? path.resolve(adminDir, "index.html")
      : path.resolve(publicDir, "index.html");

    try {
      const content = fs.readFileSync(indexPath, "utf-8");
      return c.html(content);
    } catch {
      // Если админ-сборка отсутствует (например, ещё не собрана) —
      // не падаем, отдаём информативное 404.
      if (isAdminPath) {
        return c.text(
          "Admin bundle not found. Run `npm run build:admin` and restart.",
          404
        );
      }
      return c.json({ error: "Not Found" }, 404);
    }
  });
}

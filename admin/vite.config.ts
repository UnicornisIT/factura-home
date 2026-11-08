import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const __dirname = import.meta.dirname;

// https://vite.dev/config/
export default defineConfig({
  // base=/admin/ чтобы собранный бандл ссылался на свои ассеты
  // как /admin/assets/... — тогда Hono-статика dist/admin корректно
  // их отдаёт (см. app/api/lib/vite.ts).
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    // Все /api-запросы проксируем на storefront-сервер (порт 3000),
    // где крутится @hono/vite-dev-server с нашим tRPC-API и OAuth.
    // cookie пробрасываются в обе стороны — авторизация общая.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // Не подменяем cookie-домен: на localhost он и так общий через path=/.
      },
      "/uploads": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Только для type-only импорта AppRouter из ../app/api/router.ts.
      // Vite type-only импорты стирает, поэтому runtime-путей здесь нет.
      "@server": path.resolve(__dirname, "../app"),
    },
  },
  build: {
    // Собираемся в app/dist/admin, чтобы продовый Node-сервер
    // (app/dist/boot.js) раздавал нас на /admin/* через lib/vite.ts.
    outDir: path.resolve(__dirname, "../app/dist/admin"),
    emptyOutDir: true,
  },
});

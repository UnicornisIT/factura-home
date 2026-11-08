import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
      db: path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    // Тесты живут в tests/ и в api/ — подключаются оба.
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
    ],
    // Глобальный setup: выставляет DB_DIALECT=sqlite и NODE_ENV=test ДО
    // того, как любой тест импортнёт api/lib/env.ts.
    setupFiles: ["./tests/setup.ts"],
    // Каждый тестовый файл — изолированный пул: env.dbDialect singleton
    // инициализируется заново, в :memory: SQLite. Это убирает состояние
    // между файлами.
    pool: "forks",
    isolate: true,
    fileParallelism: true,
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const adminRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(adminRoot, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { build } from "esbuild";

const version = (
  await readFile(new URL("../../VERSION", import.meta.url), "utf8")
).trim();
if (!/^\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error("Invalid VERSION");
}

await build({
  entryPoints: ["api/boot.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  packages: "external",
  outdir: "dist",
  define: { FACTURA_BUILD_VERSION: JSON.stringify(version) },
  banner: {
    js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);const __filename = import.meta.url.slice(7);const __dirname = __filename.slice(0, __filename.lastIndexOf('/'));",
  },
});

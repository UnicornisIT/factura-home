import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
const directory = await mkdtemp(join(tmpdir(), "glina-smoke-"));
const config = {
  ...process.env,
  NODE_ENV: "production",
  DB_DIALECT: "sqlite",
  SQLITE_PATH: join(directory, "shop.db"),
  UPLOAD_DIR: join(directory, "uploads"),
  PORT: "3199",
  HOST: "127.0.0.1",
  PUBLIC_ORIGIN: "https://shop.example.com",
  APP_SECRET: "test-only-secret-with-at-least-32-characters",
  TELEGRAM_BOT_TOKEN: "test-only-bot-token",
  TELEGRAM_BOT_NAME: "test_bot",
  SUPER_ADMIN_TELEGRAM_ID: "100",
};
delete config.DEV_ADMIN_ORIGIN;
let server: ReturnType<typeof spawn> | undefined;
try {
  for (const source of ["db/migrate.ts", "db/migrate.ts", "db/seed.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", source], {
      env: config,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  server = spawn(process.execPath, ["dist/boot.js"], {
    env: config,
    stdio: "pipe",
    windowsHide: true,
  });
  let errors = "";
  server.stderr?.on("data", chunk => {
    errors += String(chunk);
  });
  const base = "http://127.0.0.1:3199";
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(base + "/api/trpc/ping")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the child to bind its socket. */
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, errors);
  for (const path of ["/", "/admin/", "/admin/products"]) {
    const response = await fetch(base + path, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(html.includes('<div id="root"></div>'));
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset);
    assert.equal((await fetch(base + asset)).status, 200);
  }
  const json = {
    origin: config.PUBLIC_ORIGIN,
    "content-type": "application/json",
  };
  for (const path of ["auth.local.login", "auth.telegram.devLogin"])
    assert.equal(
      (
        await fetch(base + "/api/trpc/" + path, {
          method: "POST",
          headers: json,
          body: "{}",
        })
      ).status,
      404
    );
  assert.equal(
    (
      await fetch(base + "/api/trpc/auth.logout", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      })
    ).status,
    403
  );
  const data = { id: 100, auth_date: Math.floor(Date.now() / 1000) };
  const hash = createHmac(
    "sha256",
    createHash("sha256").update(config.TELEGRAM_BOT_TOKEN).digest()
  )
    .update(`auth_date=${data.auth_date}\nid=${data.id}`)
    .digest("hex");
  const login = await fetch(base + "/api/trpc/auth.telegram.verify", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ json: { ...data, hash } }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get("set-cookie") || "";
  assert.ok(
    cookie.includes("Secure") &&
      cookie.includes("HttpOnly") &&
      cookie.includes("SameSite=Lax")
  );
  const failed = await fetch(base + "/api/trpc/products.update", {
    method: "POST",
    headers: { ...json, cookie: cookie.split(";")[0] },
    body: JSON.stringify({ json: { id: 999999, name: "Test" } }),
  });
  assert.equal(failed.status, 500);
  const failure = await failed.text();
  assert.ok(
    failure.includes("Internal Server Error") &&
      !failure.includes("Product not found") &&
      !failure.includes('"stack"')
  );
  const denied = await fetch(base + "/api/trpc/allowlist.list");
  assert.equal(denied.status, 401);
  assert.ok(!(await denied.text()).includes('"stack"'));
  process.stdout.write(
    "Production smoke passed: clean migrations, seed, storefront, admin routes/assets, auth, cookies, CSRF.\n"
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise<void>(resolve => server!.once("exit", () => resolve()));
  }
  assert.ok(directory.startsWith(join(tmpdir(), "glina-smoke-")));
  await rm(directory, { recursive: true, force: true });
}

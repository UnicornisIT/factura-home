import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
const directory = await mkdtemp(join(tmpdir(), "factura-smoke-"));
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
  for (const command of [
    ["db/migrate.ts"],
    ["db/bootstrap-admins.ts", "200", "300"],
    ["db/migrate.ts"],
    ["db/bootstrap-admins.ts", "200", "300"],
    ["db/seed.ts"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", ...command],
      {
        env: config,
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      }
    );
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
  for (const path of [
    "/",
    "/editor-preview",
    "/editor-preview/published",
    "/admin/",
    "/admin/products",
    "/admin/builder",
    "/admin/preview",
  ]) {
    const response = await fetch(base + path, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    const html = await response.text();
    assert.ok(html.includes('<div id="root"></div>'));
    if (path === "/")
      assert.ok(html.includes('rel="icon" href="/img/favicon-leaf.png"'));
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset);
    assert.equal((await fetch(base + asset)).status, 200);
  }
  const favicon = await fetch(base + "/img/favicon-leaf.png");
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type") ?? "", /^image\/png\b/);
  const ping = await (await fetch(base + "/api/trpc/ping")).json();
  assert.equal(
    ping.result.data.json.version,
    (await readFile("../VERSION", "utf8")).trim()
  );
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
  const telegramLogin = (id: number) => {
    const auth_date = Math.floor(Date.now() / 1000);
    const hash = createHmac(
      "sha256",
      createHash("sha256").update(config.TELEGRAM_BOT_TOKEN).digest()
    )
      .update(`auth_date=${auth_date}\nid=${id}`)
      .digest("hex");
    return fetch(base + "/api/trpc/auth.telegram.verify", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ json: { id, auth_date, hash } }),
    });
  };
  for (const id of [200, 300]) {
    const admin = await telegramLogin(id);
    assert.equal(admin.status, 200, await admin.text());
    const permissions = await fetch(base + "/api/trpc/allowlist.list", {
      headers: { cookie: admin.headers.get("set-cookie")!.split(";")[0] },
    });
    assert.equal(permissions.status, 403);
  }
  assert.equal((await telegramLogin(400)).status, 403);
  const login = await telegramLogin(100);
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
  const draftUrl = base + "/api/trpc/blocks.draft.get";
  assert.equal((await fetch(draftUrl)).status, 401);
  const draft = await fetch(draftUrl, {
    headers: { cookie: cookie.split(";")[0] },
  });
  assert.equal(draft.status, 200);
  assert.equal(draft.headers.get("cache-control"), "no-store");
  const snapshot = (await draft.json()).result.data.json;
  assert.equal(snapshot.hasChanges, false);
  assert.ok(snapshot.blocks.length > 0);
  process.stdout.write(
    "Production smoke passed: clean migrations, seed, storefront, admin routes/assets, auth, cookies, CSRF.\n"
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise<void>(resolve => server!.once("exit", () => resolve()));
  }
  assert.ok(directory.startsWith(join(tmpdir(), "factura-smoke-")));
  await rm(directory, { recursive: true, force: true });
}

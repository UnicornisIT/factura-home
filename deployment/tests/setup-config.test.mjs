import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseEnv } from "node:util";

const script = fileURLToPath(new URL("../setup-config.mjs", import.meta.url));

function config(operation, args = [], input = "") {
  return spawnSync(process.execPath, [script, operation, ...args], {
    encoding: "utf8",
    input,
  });
}

test("URL and client options preserve special characters without plaintext in dotenv", () => {
  const password = " p'#@:/?%\\$\"päss ";
  const url = config(
    "mysql-url",
    ["shop", "[::1]", "3307", "shop_db"],
    password,
  );
  assert.equal(url.status, 0, url.stderr);
  assert.equal(decodeURIComponent(new URL(url.stdout).password), password);
  assert.ok(!url.stdout.includes(password));

  const result = config("mysql-options", [], url.stdout);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^host="::1"$/m);
  assert.match(result.stdout, /^port="3307"$/m);
  assert.equal(
    JSON.parse(result.stdout.match(/^password=(.+)$/m)[1]),
    password,
  );
});

test("dotenv preserves a previous secret and treats shell expressions as data", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "factura-setup-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const previous = join(directory, "app.env");
  const secret =
    "secret # $(printf untrusted) " + String.fromCharCode(96) + " test";
  writeFileSync(
    previous,
    "APP_SECRET='" + secret + "'\nDATABASE_URL=old\nCUSTOM='hello world'\n",
  );
  const result = config(
    "dotenv",
    [previous],
    "DB_DIALECT=sqlite\nSQLITE_PATH=/var/lib/factura/test.db\n",
  );
  assert.equal(result.status, 0, result.stderr);
  const values = parseEnv(result.stdout);
  assert.equal(values.APP_SECRET, secret);
  assert.equal(values.CUSTOM, "hello world");
  assert.equal(values.SQLITE_PATH, "/var/lib/factura/test.db");
  assert.equal(values.DATABASE_URL, undefined);
});

test("invalid configuration fails without emitting credentials", () => {
  const invalid = config(
    "mysql-options",
    [],
    "https://shop:secret@example.com/shop",
  );
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr + invalid.stdout, /secret/);
  assert.equal(config("origin", ["http://shop.example.com"]).status, 1);
  assert.equal(config("origin", ["https://shop.example.com/admin"]).status, 1);
  assert.equal(config("origin", ["https://shop.example.com"]).status, 0);
  assert.equal(config("telegram", ["shop_bot"], '{"ok":false}').status, 1);
  const telegram = '{"ok":true,"result":{"is_bot":true,"username":"SHOP_BOT"}}';
  assert.equal(config("telegram", ["shop_bot"], telegram).status, 0);
  assert.equal(config("telegram", ["other_bot"], telegram).status, 1);
});

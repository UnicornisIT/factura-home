import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createConnection, type RowDataPacket } from "mysql2/promise";

const server = new URL(process.env.DATABASE_URL ?? "");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(server.hostname),
  "This test requires a local MySQL instance"
);
const database = "factura_migration_test_" + randomUUID().replaceAll("-", "");
const testDatabase = new URL(server);
testDatabase.pathname = `/${database}`;
const migrations = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(migrations))
  .filter(file => file.endsWith(".mysql.sql"))
  .sort();
async function statements(version: string) {
  const file = files.find(name => name.startsWith(version + "_"));
  assert.ok(file);
  return (await readFile(new URL(file, migrations), "utf8"))
    .split(";")
    .map(statement => statement.trim())
    .filter(Boolean);
}

const runMigration = () =>
  promisify(execFile)(process.execPath, ["--import", "tsx", "db/migrate.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DB_DIALECT: "mysql",
      DATABASE_URL: testDatabase.href,
    },
    timeout: 90_000,
  });

const connection = await createConnection(server.href);
let created = false;
try {
  await connection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`
  );
  created = true;
  const staging = await createConnection(testDatabase.href);
  try {
    for (const version of ["001", "002", "003"]) {
      for (const statement of await statements(version))
        await staging.query(statement);
    }
    const [logo, showName] = await statements("004");
    await staging.query(logo);
    await staging.query(showName);
    await staging.query(
      "INSERT INTO siteContent (heroText, aboutText, deliveryText, logoImage, showShopName) VALUES ('hero', 'about', 'delivery', '/kept.webp', FALSE)"
    );
    await staging.query((await statements("006"))[0]);
  } finally {
    await staging.end();
  }

  // DDL is already committed. No journal entries were written before disconnect.
  const results = await Promise.allSettled([runMigration(), runMigration()]);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
  await runMigration();

  const result = await createConnection(testDatabase.href);
  try {
    const [rows] = await result.query<RowDataPacket[]>(
      "SELECT name FROM schemaMigrations ORDER BY name"
    );
    assert.deepEqual(
      rows.map(row => row.name),
      files
    );
    const [[content]] = await result.query<RowDataPacket[]>(
      "SELECT logoImage, showShopName, footerText, designJson FROM siteContent"
    );
    assert.equal(content.logoImage, "/kept.webp");
    assert.equal(content.showShopName, 0);
    assert.equal(content.footerText, "");
    assert.equal(content.designJson, "{}");
  } finally {
    await result.end();
  }
  console.log("MySQL migration recovery and concurrent retry passed");
} finally {
  try {
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
  } finally {
    await connection.end();
  }
}

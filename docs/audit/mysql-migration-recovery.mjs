import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const directory = process.argv[2];
assert.ok(directory, "Usage: node mysql-migration-recovery.mjs path/to/migrations");
const files = readdirSync(directory).filter(name => name.endsWith(".mysql.sql")).sort();
const interrupted = files.findIndex(name => name.startsWith("004_"));
assert.ok(interrupted > 0, "Expected migration 004");
const sql = name => readFileSync(join(directory, name), "utf8");
const name = "factura-audit-" + randomUUID();
const docker = (args, input) =>
  spawnSync("docker", args, { encoding: "utf8", input, timeout: 180_000 });
const run = (args, input) => {
  const result = docker(args, input);
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
};
const mysqlArgs = ["exec", "-i", name, "mysql", "--user=root", "--batch", "--skip-column-names", "factura_audit"];

try {
  run([
    "run", "--detach", "--rm", "--name", name, "--network", "none",
    "-e", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", "-e", "MYSQL_DATABASE=factura_audit", "mysql:8.4",
  ]);

  for (let attempt = 0; attempt < 45; attempt++) {
    const ready = docker([...mysqlArgs, "-e", "SELECT VERSION(), @@skip_networking"]);
    if (ready.status === 0 && ready.stdout.trim().startsWith("8.4") && ready.stdout.trim().endsWith("\t0")) break;
    assert.ok(attempt < 44, "MySQL 8.4 did not finish initialization");
    await setTimeout(2000);
  }
  for (const file of files.slice(0, interrupted)) run(mysqlArgs, sql(file));

  const migration = sql(files[interrupted]);
  const firstStatement = migration.split(";")[0];
  run(mysqlArgs, firstStatement + ";");

  // The connection that applied the ALTER is gone. No migration marker was written.
  assert.equal(
    run(mysqlArgs, `SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'siteContent' AND column_name = 'logoImage';`),
    "1",
  );
  const retry = docker(mysqlArgs, migration);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /ERROR 1060.*Duplicate column name 'logoImage'/);
  console.log("MySQL 8.4 retained the interrupted DDL and rejected the retry");
} finally {
  docker(["rm", "--force", "--volumes", name]);
}

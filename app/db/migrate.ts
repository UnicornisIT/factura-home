import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { env } from "../api/lib/env";
import {
  securitySql,
  securityTransaction,
  type Sql,
} from "../api/queries/security-store";
import { ensureOwner } from "../api/queries/admin-allowlist";
import { ensureDefaultBlocks } from "../api/queries/blocks";
async function migrate() {
  const directory = new URL("./migrations/", import.meta.url);
  const files = readdirSync(directory)
    .filter(name => name.endsWith(`.${env.dbDialect}.sql`))
    .sort();
  const apply = async (execute: Sql) => {
    await execute(
      "CREATE TABLE IF NOT EXISTS schemaMigrations (name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, appliedAt BIGINT NOT NULL)"
    );
    for (const file of files) {
      const source = readFileSync(new URL(file, directory), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const [previous] = await execute(
        "SELECT checksum FROM schemaMigrations WHERE name = ?",
        [file]
      );
      if (previous) {
        if (previous.checksum !== checksum)
          throw new Error(`Applied migration was modified: ${file}`);
        continue;
      }
      // Migration files use individual SQL statements without stored procedures or delimiters.
      for (const statement of source
        .split(";")
        .map(value => value.trim())
        .filter(Boolean))
        await execute(statement);
      await execute(
        "INSERT INTO schemaMigrations (name, checksum, appliedAt) VALUES (?, ?, ?)",
        [file, checksum, Date.now()]
      );
    }
  };
  if (env.dbDialect === "sqlite") await securityTransaction(apply);
  else await apply(securitySql);
  await ensureOwner();
  // Стартовый набор блоков конструктора из текущих текстов siteContent.
  // Идемпотентно: на непустой таблице blocks ничего не делает.
  await ensureDefaultBlocks();
}
migrate()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });

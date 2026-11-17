import { createConnection } from "mysql2/promise";
import type { Sql } from "../api/queries/security-store";

export async function withMysqlMigrationLock(
  databaseUrl: string,
  migrate: (execute: Sql) => Promise<void>
) {
  const connection = await createConnection(databaseUrl);
  const execute: Sql = async (sql, values = []) => {
    const [rows] = await connection.execute(sql, values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
  try {
    const [lock] = await execute(
      "SELECT GET_LOCK(CONCAT('factura:migrate:', LEFT(SHA2(DATABASE(), 256), 48)), 60) AS acquired"
    );
    if (Number(lock?.acquired) !== 1)
      throw new Error("Could not acquire the MySQL migration lock");
    await migrate(execute);
  } finally {
    // MySQL releases advisory locks when their connection closes.
    connection.destroy();
  }
}

async function columnExists(
  execute: Sql,
  table: string,
  column: string,
  type: string,
  nullable: string,
  defaultValue: string | undefined
) {
  const [row] = await execute(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!row) return false;
  const expectedType = type === "BOOLEAN" ? "tinyint(1)" : type.toLowerCase();
  const expectedDefault =
    defaultValue === "TRUE" ? "1" : (defaultValue?.slice(1, -1) ?? null);
  if (
    row.type !== expectedType ||
    row.nullable !== (nullable === "NULL" ? "YES" : "NO") ||
    (row.defaultValue === null ? null : String(row.defaultValue)) !==
      expectedDefault ||
    row.extra !== ""
  )
    throw new Error(
      `MySQL migration found an incompatible column: ${table}.${column}`
    );
  return true;
}

async function uniqueIndexExists(
  execute: Sql,
  table: string,
  name: string,
  column: string
) {
  const rows = await execute(
    `SELECT NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS prefixLength
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  if (rows.length === 0) return false;
  const [row] = rows;
  if (
    rows.length !== 1 ||
    Number(row.nonUnique) !== 0 ||
    row.columnName !== column ||
    row.prefixLength !== null
  )
    throw new Error(
      `MySQL migration found an incompatible index: ${table}.${name}`
    );
  return true;
}

export async function applyMysqlStatement(execute: Sql, statement: string) {
  const alter = /^ALTER TABLE (\w+)\s+([\s\S]+)$/.exec(statement);
  if (!alter) {
    await execute(statement);
    return;
  }
  const [, table, definition] = alter;
  if (definition === "ENGINE=InnoDB") {
    const [row] = await execute(
      "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [table]
    );
    if (row?.engine !== "InnoDB") await execute(statement);
    return;
  }

  // Check each clause before skipping a committed ADD statement whose journal
  // entry was never written. A multi-clause ALTER commits as one InnoDB operation.
  const checks = definition.split(/,\s*(?=ADD )/).map(clause => {
    const column =
      /^ADD COLUMN (\w+) (VARCHAR\(\d+\)|TEXT|JSON|BOOLEAN) (NULL|NOT NULL)(?: DEFAULT (TRUE|'[^']*'))?$/.exec(
        clause
      );
    if (column) {
      const [, name, type, nullable, defaultValue] = column;
      return () =>
        columnExists(execute, table, name, type, nullable, defaultValue);
    }
    const index = /^ADD UNIQUE INDEX (\w+) \((\w+)\)$/.exec(clause);
    if (index) {
      const [, name, columnName] = index;
      return () => uniqueIndexExists(execute, table, name, columnName);
    }
  });
  const present: boolean[] = [];
  for (const check of checks) {
    if (!check) {
      await execute(statement);
      return;
    }
    present.push(await check());
  }
  if (present.every(Boolean)) return;
  if (present.some(Boolean))
    throw new Error(
      `MySQL migration found a partially defined ALTER TABLE on ${table}`
    );
  await execute(statement);
}

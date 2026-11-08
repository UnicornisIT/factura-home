import { createPool, type PoolConnection } from "mysql2/promise";
import { __getSqliteClient } from "./connection";
import { env } from "../lib/env";

export type Sql = (
  sql: string,
  values?: (string | number | null)[]
) => Promise<Record<string, unknown>[]>;
let pool: ReturnType<typeof createPool> | undefined;
let queue = Promise.resolve();

function executor(connection?: PoolConnection): Sql {
  return async (sql, values = []) => {
    if (env.dbDialect === "sqlite") {
      const statement = __getSqliteClient().prepare(sql);
      return statement.reader
        ? (statement.all(...values) as Record<string, unknown>[])
        : (statement.run(...values), []);
    }
    pool ??= createPool(env.databaseUrl);
    const [rows] = await (connection ?? pool).execute(sql, values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

// Serialize SQLite transactions because its single connection cannot host overlapping transactions.
export async function securityTransaction<T>(
  operation: (sql: Sql) => Promise<T>
): Promise<T> {
  if (env.dbDialect === "mysql") {
    pool ??= createPool(env.databaseUrl);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(executor(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  const sql = executor();
  try {
    await sql("BEGIN IMMEDIATE");
    const result = await operation(sql);
    await sql("COMMIT");
    return result;
  } catch (error) {
    await sql("ROLLBACK");
    throw error;
  } finally {
    release();
  }
}

export const securitySql: Sql = (...args) => executor()(...args);

export async function audit(
  sql: Sql,
  actor: number,
  action: string,
  target: number | null,
  before: string | null,
  after: string | null,
  outcome = "success"
) {
  await sql(
    "INSERT INTO adminAuditLog (createdAt, actorTelegramId, targetTelegramId, action, roleBefore, roleAfter, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [Date.now(), actor, target, action, before, after, outcome]
  );
}

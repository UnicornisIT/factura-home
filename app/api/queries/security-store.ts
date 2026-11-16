import { createPool, type PoolConnection } from "mysql2/promise";
import { __getSqliteClient } from "./connection";
import { env } from "../lib/env";

type SqlParams = [sql: string, values?: (string | number | null)[]];
type SqlRows = Record<string, unknown>[];
export type Sql = (...args: SqlParams) => Promise<SqlRows>;
let pool: ReturnType<typeof createPool> | undefined;
let queue = Promise.resolve();

function sqliteExecute(sql: string, values: SqlParams[1] = []): SqlRows {
  const statement = __getSqliteClient().prepare(sql);
  return statement.reader
    ? (statement.all(...values) as SqlRows)
    : (statement.run(...values), []);
}

function executor(connection?: PoolConnection): Sql {
  return async (sql, values = []) => {
    if (env.dbDialect === "sqlite") return sqliteExecute(sql, values);
    pool ??= createPool(env.databaseUrl);
    const [rows] = await (connection ?? pool).execute(sql, values);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  };
}

export type SqlTransaction<T> = Generator<SqlParams, T, SqlRows>;

export function runSqlTransaction<T>(
  operation: () => SqlTransaction<T>
): Promise<T> {
  const steps = operation();
  if (env.dbDialect === "mysql")
    return securityTransaction(async sql => {
      let step = steps.next();
      while (!step.done) step = steps.next(await sql(...step.value));
      return step.value;
    });

  // A synchronous SQLite transaction prevents reads on the shared connection
  // from observing the intermediate state of a publication.
  return withSqliteTransactionLock(() =>
    __getSqliteClient()
      .transaction(() => {
        let step = steps.next();
        while (!step.done) step = steps.next(sqliteExecute(...step.value));
        return step.value;
      })
      .immediate()
  );
}

// The shared SQLite connection cannot host overlapping transactions.
export async function withSqliteTransactionLock<T>(
  operation: () => T | Promise<T>
) {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
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
  return withSqliteTransactionLock(async () => {
    const sql = executor();
    await sql("BEGIN IMMEDIATE");
    try {
      const result = await operation(sql);
      await sql("COMMIT");
      return result;
    } catch (error) {
      await sql("ROLLBACK");
      throw error;
    }
  });
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

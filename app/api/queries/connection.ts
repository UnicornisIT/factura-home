import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { env } from "../lib/env";
import * as schema from "@db/schema";

const fullSchema = { ...schema };

type AnyDb = any;

let instance: AnyDb = null;
let sqliteClient: Database.Database | null = null;

export function getDb(): AnyDb {
  if (!instance) {
    if (env.dbDialect === "sqlite") {
      sqliteClient = new Database(env.sqlitePath);
      // Для dev-файла и :memory: включаем WAL-режим и foreign_keys —
      // стабильнее в параллельных тестах и ближе к поведению MySQL.
      sqliteClient.pragma("journal_mode = WAL");
      sqliteClient.pragma("foreign_keys = ON");
      instance = drizzleSqlite(sqliteClient, { schema: fullSchema });
    } else {
      instance = drizzleMysql(env.databaseUrl, {
        mode: "planetscale",
        schema: fullSchema,
      });
    }
  }
  return instance;
}

export function __resetDbForTests(): void {
  if (sqliteClient) {
    sqliteClient.close();
    sqliteClient = null;
  }
  instance = null;
}

export function __getSqliteClient(): Database.Database {
  if (env.dbDialect !== "sqlite") {
    throw new Error("__getSqliteClient is only available in SQLite mode");
  }
  getDb(); // ensure initialised
  if (!sqliteClient) throw new Error("SQLite client not initialised");
  return sqliteClient;
}

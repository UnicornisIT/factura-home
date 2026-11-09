import * as mysqlSchema from "./schema-mysql";
import * as sqliteSchema from "./schema-sqlite";
import { env } from "../api/lib/env";

const active = env.dbDialect === "sqlite" ? sqliteSchema : mysqlSchema;

export const collections = active.collections;
export const products = active.products;
export const orders = active.orders;
export const siteContent = active.siteContent;
export const blocks = active.blocks;
export const adminAllowlist = active.adminAllowlist;

// Канонические TS-типы берём из MySQL-схемы — оба диалекта дают идентичные
// $inferSelect типы (см. комментарий в schema-sqlite.ts).
export type {
  Collection,
  Product,
  Order,
  SiteContent,
  Block,
  AdminAllowlistEntry,
} from "./schema-mysql";

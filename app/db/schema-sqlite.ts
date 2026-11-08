import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const ts = sql`((unixepoch()))`;

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  coverImage: text("coverImage"),
  sortOrder: integer("sortOrder").default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(ts).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .default(ts)
    .notNull()
    .$onUpdate(() => new Date()),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionId: integer("collectionId")
    .notNull()
    .references(() => collections.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  material: text("material").default(""),
  price: integer("price").notNull(),
  image: text("image"),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  sortOrder: integer("sortOrder").default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(ts).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .default(ts)
    .notNull()
    .$onUpdate(() => new Date()),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  comment: text("comment"),
  items: text("items").notNull(),
  total: integer("total").notNull(),
  status: text("status", { enum: ["new", "in_progress", "shipped", "done"] })
    .default("new")
    .notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(ts).notNull(),
});

export const siteContent = sqliteTable("siteContent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shopName: text("shopName").notNull().default("Глиняная мастерская"),
  heroTitle: text("heroTitle")
    .notNull()
    .default("Декор для дома ручной работы"),
  heroText: text("heroText").notNull(),
  aboutTitle: text("aboutTitle").notNull().default("О мастерской"),
  aboutText: text("aboutText").notNull(),
  aboutImage: text("aboutImage"),
  deliveryTitle: text("deliveryTitle")
    .notNull()
    .default("Доставка по всей России"),
  deliveryText: text("deliveryText").notNull(),
  footerCta: text("footerCta")
    .notNull()
    .default("Для заказа напишите в удобный для вас мессенджер"),
  telegram: text("telegram").default(""),
  whatsapp: text("whatsapp").default(""),
  email: text("email").default(""),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .default(ts)
    .notNull()
    .$onUpdate(() => new Date()),
});

// ── Allowlist для Telegram-логина в админку ────────────────────
// См. комментарий в schema-mysql.ts — структура идентична.
export const adminAllowlist = sqliteTable("adminAllowlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegramId").notNull().unique(),
  role: text("role", { enum: ["super_admin", "admin"] })
    .default("admin")
    .notNull(),
  addedAt: integer("addedAt", { mode: "timestamp" }).default(ts).notNull(),
  addedByTelegramId: integer("addedByTelegramId"),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
});

// ── Типы (канон) ───────────────────────────────────────────────
// Берём из MySQL-схемы, потому что $inferSelect даёт идентичные TS-типы
// для mysql и sqlite вариантов (см. комментарий вверху файла).
export type {
  Collection,
  Product,
  Order,
  SiteContent,
  AdminAllowlistEntry,
} from "./schema-mysql";

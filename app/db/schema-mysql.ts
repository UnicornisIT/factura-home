import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  boolean,
  bigint,
} from "drizzle-orm/mysql-core";

export const collections = mysqlTable("collections", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  coverImage: text("coverImage"),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Collection = typeof collections.$inferSelect;

export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  collectionId: bigint("collectionId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => collections.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 255 }).notNull(),
  material: varchar("material", { length: 255 }).default(""),
  price: int("price").notNull(),
  image: text("image"),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Product = typeof products.$inferSelect;

export const orders = mysqlTable("orders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  contact: varchar("contact", { length: 320 }).notNull(),
  comment: text("comment"),
  items: text("items").notNull(), // JSON: [{productId, name, price, qty}]
  total: int("total").notNull(),
  status: mysqlEnum("status", ["new", "in_progress", "shipped", "done"])
    .default("new")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;

// ── Тексты сайта (редактируемые владельцем) ────────────────

export const siteContent = mysqlTable("siteContent", {
  id: serial("id").primaryKey(),
  shopName: varchar("shopName", { length: 255 })
    .notNull()
    .default("Глиняная мастерская"),
  heroTitle: varchar("heroTitle", { length: 500 })
    .notNull()
    .default("Декор для дома ручной работы"),
  heroText: text("heroText").notNull(),
  aboutTitle: varchar("aboutTitle", { length: 255 })
    .notNull()
    .default("О мастерской"),
  aboutText: text("aboutText").notNull(),
  aboutImage: text("aboutImage"),
  deliveryTitle: varchar("deliveryTitle", { length: 255 })
    .notNull()
    .default("Доставка по всей России"),
  deliveryText: text("deliveryText").notNull(),
  footerCta: varchar("footerCta", { length: 500 })
    .notNull()
    .default("Для заказа напишите в удобный для вас мессенджер"),
  telegram: varchar("telegram", { length: 500 }).default(""),
  whatsapp: varchar("whatsapp", { length: 500 }).default(""),
  email: varchar("email", { length: 320 }).default(""),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type SiteContent = typeof siteContent.$inferSelect;

// ── Allowlist для Telegram-логина в админку ────────────────────
// Только здесь перечисленные telegramId могут войти через Telegram Login Widget.
// Роль super_admin может добавлять/удалять записи через админ-панель.
// Поле `addedByTelegramId` хранит, кто добавил (null для bootstrap-записи).

export const adminAllowlist = mysqlTable("adminAllowlist", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegramId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  role: mysqlEnum("role", ["super_admin", "admin"]).default("admin").notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
  addedByTelegramId: bigint("addedByTelegramId", {
    mode: "number",
    unsigned: true,
  }),
  isActive: boolean("isActive").default(true).notNull(),
});

export type AdminAllowlistEntry = typeof adminAllowlist.$inferSelect;

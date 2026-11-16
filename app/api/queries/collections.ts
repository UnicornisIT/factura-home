import { asc, count, eq, getTableColumns, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { TRPCError } from "@trpc/server";
import { collections, products } from "@db/schema";
import type { Collection } from "@db/schema";
import { insertAndReturn } from "./_shared";
import { env } from "../lib/env";

export async function listCollections(): Promise<Collection[]> {
  return getDb().select().from(collections).orderBy(asc(collections.sortOrder));
}

export async function listCollectionsWithProductCounts(): Promise<
  (Collection & { productCount: number })[]
> {
  const db = getDb();
  const counts = db
    .select({
      collectionId: products.collectionId,
      total: count().as("total"),
    })
    .from(products)
    .groupBy(products.collectionId)
    .as("product_counts");

  return db
    .select({
      ...getTableColumns(collections),
      productCount: sql`coalesce(${counts.total}, 0)`.mapWith(Number),
    })
    .from(collections)
    .leftJoin(counts, eq(counts.collectionId, collections.id))
    .orderBy(asc(collections.sortOrder));
}

export async function createCollection(data: {
  slug: string;
  title: string;
  description?: string;
  coverImage?: string | null;
  sortOrder?: number;
}): Promise<Collection> {
  return insertAndReturn(collections, data);
}

export async function updateCollection(
  id: number,
  data: Partial<
    Pick<
      Collection,
      "slug" | "title" | "description" | "coverImage" | "sortOrder"
    >
  >
): Promise<Collection> {
  await getDb().update(collections).set(data).where(eq(collections.id, id));
  const rows = await getDb()
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1);
  if (!rows[0]) throw new Error("Collection not found");
  return rows[0];
}

export async function deleteCollection(id: number): Promise<void> {
  const db = getDb();
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.collectionId, id))
    .limit(1);
  if (product) throw collectionHasProducts();

  let deleted: number;
  try {
    const result = await db.delete(collections).where(eq(collections.id, id));
    deleted =
      env.dbDialect === "sqlite" ? result.changes : result[0].affectedRows;
  } catch (error) {
    // A product can be added after the check. The foreign key protects the delete.
    if (isForeignKeyRestriction(error)) throw collectionHasProducts();
    throw error;
  }

  if (deleted === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Коллекция не найдена" });
  }
}

function collectionHasProducts() {
  return new TRPCError({
    code: "CONFLICT",
    message: "Сначала удалите или переместите товары коллекции",
  });
}

function isForeignKeyRestriction(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    const code = "code" in cause ? cause.code : undefined;
    if (
      code === "ER_ROW_IS_REFERENCED_2" ||
      code === "ER_ROW_IS_REFERENCED" ||
      code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      (code === "SQLITE_CONSTRAINT_TRIGGER" &&
        cause.message.includes("FOREIGN KEY constraint failed"))
    ) {
      return true;
    }
  }
  return false;
}

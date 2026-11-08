import { asc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { TRPCError } from "@trpc/server";
import { collections, products } from "@db/schema";
import type { Collection } from "@db/schema";
import { insertAndReturn } from "./_shared";

export async function listCollections(): Promise<Collection[]> {
  return getDb().select().from(collections).orderBy(asc(collections.sortOrder));
}

export async function createCollection(data: {
  slug: string;
  title: string;
  coverImage?: string | null;
  sortOrder?: number;
}): Promise<Collection> {
  return insertAndReturn(collections, data);
}

export async function updateCollection(
  id: number,
  data: Partial<Pick<Collection, "slug" | "title" | "coverImage" | "sortOrder">>
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
  const [product] = await getDb()
    .select({ id: products.id })
    .from(products)
    .where(eq(products.collectionId, id))
    .limit(1);
  if (product)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Сначала удалите или переместите товары коллекции",
    });
  await getDb().delete(collections).where(eq(collections.id, id));
}

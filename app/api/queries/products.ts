import { asc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { TRPCError } from "@trpc/server";
import { collections, products } from "@db/schema";
import type { Product } from "@db/schema";
import { insertAndReturn } from "./_shared";

export async function listProducts(): Promise<Product[]> {
  return getDb()
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.sortOrder));
}

export async function listAllProducts(): Promise<Product[]> {
  return getDb().select().from(products).orderBy(asc(products.sortOrder));
}

export async function createProduct(data: {
  collectionId: number;
  name: string;
  material?: string;
  price: number;
  image?: string | null;
  sortOrder?: number;
}): Promise<Product> {
  await requireCollection(data.collectionId);
  return insertAndReturn(products, data);
}

export async function updateProduct(
  id: number,
  data: Partial<
    Pick<
      Product,
      | "collectionId"
      | "name"
      | "material"
      | "price"
      | "image"
      | "isActive"
      | "sortOrder"
    >
  >
): Promise<Product> {
  if (data.collectionId !== undefined)
    await requireCollection(data.collectionId);
  await getDb().update(products).set(data).where(eq(products.id, id));
  const rows = await getDb()
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!rows[0]) throw new Error("Product not found");
  return rows[0];
}

export async function deleteProduct(id: number): Promise<void> {
  await getDb().delete(products).where(eq(products.id, id));
}

async function requireCollection(id: number) {
  const [row] = await getDb()
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Коллекция не найдена",
    });
}

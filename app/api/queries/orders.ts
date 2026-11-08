import { desc, eq, count } from "drizzle-orm";
import { getDb } from "./connection";
import { orders } from "@db/schema";
import type { Order } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { listProducts } from "./products";
import { insertAndReturn } from "./_shared";

export type OrderItemInput = {
  productId: number;
  name: string;
  price: number;
  qty: number;
};

export async function createOrder(data: {
  name: string;
  contact: string;
  comment?: string;
  items: { productId: number; qty: number }[];
}): Promise<Order> {
  const catalog = await listProducts();
  const quantities = new Map<number, number>();
  for (const item of data.items)
    quantities.set(
      item.productId,
      (quantities.get(item.productId) ?? 0) + item.qty
    );
  const items = Array.from(quantities, ([productId, qty]) => {
    const product = catalog.find(p => p.id === productId);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Товар недоступен или указано неверное количество",
      });
    return { productId, qty, name: product.name, price: product.price };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > 2147483647)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Некорректная сумма заказа",
    });
  return insertAndReturn(orders, {
    name: data.name,
    contact: data.contact,
    comment: data.comment ?? null,
    items: JSON.stringify(items),
    total,
  });
}

export async function listOrders(): Promise<Order[]> {
  return getDb().select().from(orders).orderBy(desc(orders.createdAt));
}

export async function countNewOrders(): Promise<number> {
  const rows = await getDb()
    .select({ n: count() })
    .from(orders)
    .where(eq(orders.status, "new"));
  return rows[0]?.n ?? 0;
}

export async function updateOrderStatus(
  id: number,
  status: "new" | "in_progress" | "shipped" | "done"
): Promise<void> {
  await getDb().update(orders).set({ status }).where(eq(orders.id, id));
}

export async function deleteOrder(id: number): Promise<void> {
  await getDb().delete(orders).where(eq(orders.id, id));
}

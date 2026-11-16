import { desc, eq, count } from "drizzle-orm";
import { getDb } from "./connection";
import { orders } from "@db/schema";
import type { Order } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { MAX_ORDER_ITEM_QUANTITY } from "@contracts/constants";
import { listProducts } from "./products";
import { insertAndReturn } from "./_shared";
import { env } from "../lib/env";
import { enqueueOrderNotifications } from "./order-notifications";
import { withSqliteTransactionLock } from "./security-store";
import type { ContactDetails } from "@contracts/order-contacts";

type PublicOrder = Omit<Order, "requestKey">;

function withoutRequestKey(order: Order): PublicOrder {
  const result: PublicOrder & { requestKey?: Order["requestKey"] } = {
    ...order,
  };
  delete result.requestKey;
  return result;
}

export async function findOrderByRequestKey(requestKey: string) {
  const query = async () => {
    const [order]: Order[] = await getDb()
      .select()
      .from(orders)
      .where(eq(orders.requestKey, requestKey))
      .limit(1);
    return order && withoutRequestKey(order);
  };
  return env.dbDialect === "sqlite"
    ? withSqliteTransactionLock(query)
    : query();
}

export type OrderItemInput = {
  productId: number;
  name: string;
  price: number;
  qty: number;
};

export async function createOrder(data: {
  name: string;
  contact: string;
  contactDetails?: ContactDetails;
  requestKey?: string;
  comment?: string;
  items: { productId: number; qty: number }[];
}): Promise<PublicOrder> {
  const catalog = await listProducts();
  const quantities = new Map<number, number>();
  for (const item of data.items)
    quantities.set(
      item.productId,
      (quantities.get(item.productId) ?? 0) + item.qty
    );
  const items = Array.from(quantities, ([productId, qty]) => {
    const product = catalog.find(p => p.id === productId);
    if (
      !product ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_ORDER_ITEM_QUANTITY
    )
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
  const values = {
    name: data.name,
    contact: data.contact,
    contactDetails: data.contactDetails ?? null,
    requestKey: data.requestKey ?? null,
    comment: data.comment ?? null,
    items: JSON.stringify(items),
    total,
  };
  const db = getDb();
  if (env.dbDialect === "sqlite")
    return withSqliteTransactionLock(() =>
      db.transaction(
        (tx: typeof db) => {
          if (data.requestKey) {
            const existing: Order | undefined = tx
              .select()
              .from(orders)
              .where(eq(orders.requestKey, data.requestKey))
              .get();
            if (existing) return withoutRequestKey(existing);
          }
          const order: Order = tx
            .insert(orders)
            .values(values)
            .returning()
            .get();
          tx.run(enqueueOrderNotifications(order.id));
          return withoutRequestKey(order);
        },
        { behavior: "immediate" }
      )
    );
  try {
    return await db.transaction(
      async (tx: typeof db) => {
        const order = await insertAndReturn(orders, values, tx);
        await tx.execute(enqueueOrderNotifications(order.id));
        return withoutRequestKey(order);
      },
      { isolationLevel: "read committed" }
    );
  } catch (error) {
    if (data.requestKey) {
      const existing = await findOrderByRequestKey(data.requestKey);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function listOrders(): Promise<PublicOrder[]> {
  const rows: Order[] = await getDb()
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt));
  return rows.map(withoutRequestKey);
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

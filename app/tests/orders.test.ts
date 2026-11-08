import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { orders } from "@db/schema";
import {
  createOrder,
  listOrders,
  countNewOrders,
  updateOrderStatus,
  deleteOrder,
} from "../api/queries/orders";
import { createCollection } from "../api/queries/collections";
import { createProduct } from "../api/queries/products";
import { resetDb } from "./helpers";

describe("orders queries (SQLite)", () => {
  beforeEach(async () => {
    resetDb();
    const collection = await createCollection({ slug: "test", title: "Test" });
    await createProduct({
      collectionId: collection.id,
      name: "Тыква",
      price: 650,
    });
    await createProduct({
      collectionId: collection.id,
      name: "Ваза",
      price: 1200,
    });
  });

  it("creates an order with items serialized to JSON", async () => {
    const o = await createOrder({
      name: "Иван",
      contact: "@ivan",
      comment: "позвонить после 18:00",
      items: [
        { productId: 1, qty: 2 },
        { productId: 2, qty: 1 },
      ],
    });

    expect(o.id).toBeGreaterThan(0);
    expect(o.status).toBe("new");
    expect(o.total).toBe(2500);
    // items должны быть валидным JSON
    const parsed = JSON.parse(o.items);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Тыква");
  });

  it("lists orders newest first", async () => {
    const a = await createOrder({
      name: "A",
      contact: "x",
      items: [{ productId: 1, qty: 1 }],
    });
    // SQLite хранит createdAt как unixepoch(), разрешение — секунда.
    // Чтобы второй заказ точно был "новее", ждём 1.1с.
    await new Promise(r => setTimeout(r, 1100));
    const b = await createOrder({
      name: "B",
      contact: "y",
      items: [{ productId: 1, qty: 1 }],
    });

    const list = await listOrders();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id); // b создан позже → должен идти первым
    expect(list[1].id).toBe(a.id);
  });

  it("counts new orders only", async () => {
    await createOrder({
      name: "A",
      contact: "x",
      items: [{ productId: 1, qty: 1 }],
    });
    await createOrder({
      name: "B",
      contact: "y",
      items: [{ productId: 1, qty: 1 }],
    });
    const o3 = await createOrder({
      name: "C",
      contact: "z",
      items: [{ productId: 1, qty: 1 }],
    });
    await updateOrderStatus(o3.id, "in_progress");

    expect(await countNewOrders()).toBe(2);
  });

  it("updates status through the full lifecycle", async () => {
    const o = await createOrder({
      name: "X",
      contact: "c",
      items: [{ productId: 1, qty: 1 }],
    });
    await updateOrderStatus(o.id, "in_progress");
    await updateOrderStatus(o.id, "shipped");
    await updateOrderStatus(o.id, "done");
    const row = await getDb()
      .select()
      .from(orders)
      .where(eq(orders.id, o.id))
      .limit(1);
    expect(row[0].status).toBe("done");
  });

  it("deletes an order", async () => {
    const o = await createOrder({
      name: "X",
      contact: "c",
      items: [{ productId: 1, qty: 1 }],
    });
    await deleteOrder(o.id);
    const rows = await getDb().select().from(orders).where(eq(orders.id, o.id));
    expect(rows).toHaveLength(0);
  });
});

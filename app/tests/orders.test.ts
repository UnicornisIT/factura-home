import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
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
import { ordersRouter } from "../api/orders-router";

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

  const checkout = ordersRouter.createCaller({
    req: new Request("http://localhost"),
    resHeaders: new Headers(),
  });
  const cart = { name: " Иван ", items: [{ productId: 1, qty: 2 }] };

  it.each([
    [
      { telegram: "@ivanov" },
      { telegram: "ivanov", preferred: "telegram" },
      "@ivanov",
    ],
    [
      { phone: "+1 (202) 555-0123" },
      { phone: "+12025550123", preferred: "phone" },
      "+12025550123",
    ],
    [
      { email: " ivan@example.ru " },
      { email: "ivan@example.ru", preferred: "email" },
      "ivan@example.ru",
    ],
    [
      { telegram: "ivanov", email: "ivan@example.ru", preferred: "email" },
      { telegram: "ivanov", email: "ivan@example.ru", preferred: "email" },
      "ivan@example.ru",
    ],
    [
      {
        telegram: "@ivanov",
        phone: "+44 20 7946-0958",
        email: "ivan@example.ru",
        preferred: "phone",
      },
      {
        telegram: "ivanov",
        phone: "+442079460958",
        email: "ivan@example.ru",
        preferred: "phone",
      },
      "+442079460958",
    ],
  ] as const)(
    "creates and reads back contacts %j",
    async (contactDetails, normalized, contact) => {
      const saved = await checkout.create({ ...cart, contactDetails });
      expect(saved).toMatchObject({
        contact,
        contactDetails: normalized,
        name: "Иван",
        total: 1300,
      });
      expect(await listOrders()).toEqual([saved]);
    }
  );

  it.each([
    { contactDetails: {} },
    { contactDetails: { telegram: "@абвгд" } },
    { contactDetails: { telegram: "https://t.me/ivanov" } },
    { contactDetails: { telegram: "@ab cd" } },
    { contactDetails: { telegram: "@abcd" } },
    { contactDetails: { telegram: "a".repeat(33) } },
    { contactDetails: { phone: "+1 CALL-ME" } },
    { contactDetails: { phone: "+00 1234567" } },
    { contactDetails: { phone: "+1 (202 555-0123" } },
    { contactDetails: { phone: "123456" } },
    { contactDetails: { phone: "0000000" } },
    { contactDetails: { phone: "+1234567890123456" } },
    { contactDetails: { email: "ivan@domain" } },
    {
      contactDetails: { telegram: "ivanov", email: "", preferred: "telegram" },
    },
    { contactDetails: { telegram: "ivanov", preferred: "email" } },
    { contactDetails: { telegram: "ivanov", email: "ivan@example.ru" } },
    { contactDetails: { telegram: "ivanov" }, name: "   " },
    { contactDetails: { telegram: "ivanov" }, name: " Я " },
    { contactDetails: { telegram: "ivanov" }, name: "Я".repeat(101) },
    { contactDetails: { telegram: "ivanov" }, honeypot: " " },
    { contactDetails: {}, contact: "ivan@example.ru" },
    { contact: "произвольный текст" },
    { contact: "123456" },
    {},
  ] as const)("rejects invalid checkout input %j", async input => {
    await expect(checkout.create({ ...cart, ...input })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await listOrders()).toEqual([]);
  });

  it("deduplicates concurrent requests and retries using the same request ID", async () => {
    const data = {
      ...cart,
      contactDetails: { email: "ivan@example.ru" },
      requestId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      checkout.create(data),
      checkout.create(data),
    ]);
    expect(second).toEqual(first);
    expect(await checkout.create(data)).toEqual(first);
    expect(await listOrders()).toEqual([first]);
    const next = await checkout.create({ ...data, requestId: randomUUID() });
    expect(next.id).not.toBe(first.id);
  });

  it("limits the same normalized contact even when the preferred method changes", async () => {
    for (let i = 0; i < 5; i++) {
      await checkout.create({
        ...cart,
        contactDetails: {
          phone: "+1 (202) 555-0123",
          email: `ivan${i}@example.ru`,
          preferred: "email",
        },
      });
    }
    await expect(
      checkout.create({ ...cart, contact: "12025550123" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await listOrders()).toHaveLength(5);
  });

  it("keeps stored legacy orders readable and validates legacy checkout input", async () => {
    const old = await createOrder({ ...cart, contact: "Старый контакт" });
    expect(old.contactDetails).toBeNull();
    expect(await listOrders()).toEqual([old]);
    const saved = await checkout.create({ ...cart, contact: "@ivanov" });
    expect(saved).toMatchObject({
      contact: "@ivanov",
      contactDetails: { telegram: "ivanov", preferred: "telegram" },
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { products } from "@db/schema";
import {
  createCollection,
  updateCollection,
  listCollections,
  deleteCollection,
} from "../api/queries/collections";
import {
  createProduct,
  updateProduct,
  listProducts,
  listAllProducts,
  deleteProduct,
} from "../api/queries/products";
import { resetDb } from "./helpers";

describe("collections queries (SQLite)", () => {
  beforeEach(() => resetDb());

  it("creates and lists a collection", async () => {
    const created = await createCollection({
      slug: "winter",
      title: "Зимняя",
      coverImage: null,
      sortOrder: 1,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.slug).toBe("winter");

    const list = await listCollections();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Зимняя");
  });

  it("updates a collection", async () => {
    const c = await createCollection({
      slug: "spring",
      title: "Весна",
      sortOrder: 1,
    });
    const updated = await updateCollection(c.id, {
      title: "Весенняя коллекция",
      sortOrder: 2,
    });
    expect(updated.title).toBe("Весенняя коллекция");
    expect(updated.sortOrder).toBe(2);
    // slug не трогали — остался прежним
    expect(updated.slug).toBe("spring");
  });

  it("deletes a collection", async () => {
    const c = await createCollection({ slug: "x", title: "X", sortOrder: 1 });
    await deleteCollection(c.id);
    const list = await listCollections();
    expect(list).toHaveLength(0);
  });

  it("orders by sortOrder asc", async () => {
    await createCollection({ slug: "a", title: "A", sortOrder: 3 });
    await createCollection({ slug: "b", title: "B", sortOrder: 1 });
    await createCollection({ slug: "c", title: "C", sortOrder: 2 });
    const list = await listCollections();
    expect(list.map(c => c.slug)).toEqual(["b", "c", "a"]);
  });
});

describe("products queries (SQLite)", () => {
  beforeEach(async () => {
    resetDb();
    // Без коллекции внешний ключ (даже без явного FK в SQLite) смысла не имеет,
    // но collectionId всё равно нужен — берём реальный id.
  });

  it("creates a product tied to a collection", async () => {
    const col = await createCollection({
      slug: "c1",
      title: "C1",
      sortOrder: 1,
    });
    const p = await createProduct({
      collectionId: col.id,
      name: "Тыква",
      price: 650,
      material: "глина",
    });
    expect(p.id).toBeGreaterThan(0);
    expect(p.name).toBe("Тыква");
    expect(p.isActive).toBe(true); // default
  });

  it("listProducts shows only active, listAllProducts shows everything", async () => {
    const col = await createCollection({
      slug: "c1",
      title: "C1",
      sortOrder: 1,
    });
    await createProduct({ collectionId: col.id, name: "A", price: 100 });
    const hidden = await createProduct({
      collectionId: col.id,
      name: "B",
      price: 200,
    });
    await updateProduct(hidden.id, { isActive: false });

    const visible = await listProducts();
    const all = await listAllProducts();
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("A");
    expect(all).toHaveLength(2);
  });

  it("updates product fields", async () => {
    const col = await createCollection({
      slug: "c1",
      title: "C1",
      sortOrder: 1,
    });
    const p = await createProduct({
      collectionId: col.id,
      name: "P",
      price: 100,
    });
    const updated = await updateProduct(p.id, {
      name: "P2",
      price: 999,
      isActive: false,
    });
    expect(updated.name).toBe("P2");
    expect(updated.price).toBe(999);
    expect(updated.isActive).toBe(false);
  });

  it("deletes a product", async () => {
    const col = await createCollection({
      slug: "c1",
      title: "C1",
      sortOrder: 1,
    });
    const p = await createProduct({
      collectionId: col.id,
      name: "P",
      price: 100,
    });
    await deleteProduct(p.id);
    const rows = await getDb()
      .select()
      .from(products)
      .where(eq(products.id, p.id));
    expect(rows).toHaveLength(0);
  });
});

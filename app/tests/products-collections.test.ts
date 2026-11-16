import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { __getSqliteClient, getDb } from "../api/queries/connection";
import { products } from "@db/schema";
import { collectionsRouter } from "../api/collections-router";
import {
  createCollection,
  updateCollection,
  listCollections,
  listCollectionsWithProductCounts,
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

  it("deletes only the requested empty collection", async () => {
    const c = await createCollection({ slug: "x", title: "X" });
    const other = await createCollection({ slug: "y", title: "Y" });
    const product = await createProduct({
      collectionId: other.id,
      name: "P",
      price: 100,
    });
    await deleteCollection(c.id);
    expect(await listCollections()).toEqual([other]);
    expect(await listAllProducts()).toEqual([product]);
  });

  it.each([true, false])(
    "preserves a collection and its product when isActive is %s",
    async isActive => {
      const c = await createCollection({ slug: "x", title: "X" });
      const product = await createProduct({
        collectionId: c.id,
        name: "P",
        price: 100,
      });
      await updateProduct(product.id, { isActive });

      await expect(deleteCollection(c.id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await listCollections()).toEqual([c]);
      expect(await listAllProducts()).toEqual([{ ...product, isActive }]);
    }
  );

  it("returns NOT_FOUND for a missing collection", async () => {
    await expect(deleteCollection(99)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("reports a conflict if a product appears after the initial check", async () => {
    const c = await createCollection({ slug: "x", title: "X" });
    // Run the insert after the application's check and before SQLite checks the foreign key.
    __getSqliteClient().exec(`
      CREATE TRIGGER insert_product_before_delete BEFORE DELETE ON collections
      BEGIN
        INSERT INTO products (collectionId, name, price) VALUES (OLD.id, 'New product', 100);
      END;
    `);

    await expect(deleteCollection(c.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await listCollections()).toEqual([c]);
  });

  it("counts active and hidden products independently for each collection", async () => {
    const empty = await createCollection({
      slug: "empty",
      title: "Empty",
      sortOrder: 1,
    });
    const mixed = await createCollection({
      slug: "mixed",
      title: "Mixed",
      sortOrder: 2,
    });
    const other = await createCollection({
      slug: "other",
      title: "Other",
      sortOrder: 3,
    });
    await createProduct({
      collectionId: mixed.id,
      name: "Visible",
      price: 100,
    });
    const hidden = await createProduct({
      collectionId: mixed.id,
      name: "Hidden",
      price: 100,
    });
    await updateProduct(hidden.id, { isActive: false });
    await createProduct({ collectionId: other.id, name: "Other", price: 100 });

    expect(await listCollectionsWithProductCounts()).toEqual([
      { ...empty, productCount: 0 },
      { ...mixed, productCount: 2 },
      { ...other, productCount: 1 },
    ]);
  });

  it("restricts counts and deletion to administrators", async () => {
    const collection = await createCollection({ slug: "x", title: "X" });
    const context = {
      req: new Request("http://localhost"),
      resHeaders: new Headers(),
    };
    const guest = collectionsRouter.createCaller(context);
    const member = collectionsRouter.createCaller({
      ...context,
      user: { authMethod: "telegram", role: "member", telegramId: 200 },
    });
    const admin = collectionsRouter.createCaller({
      ...context,
      user: { authMethod: "telegram", role: "admin", telegramId: 100 },
    });

    await expect(guest.listWithProductCounts()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(guest.delete({ id: collection.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(member.delete({ id: collection.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await admin.listWithProductCounts()).toEqual([
      { ...collection, productCount: 0 },
    ]);
    await admin.delete({ id: collection.id });
    expect(await admin.listWithProductCounts()).toEqual([]);
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
  beforeEach(() => resetDb());

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

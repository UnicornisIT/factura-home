import { describe, it, expect, beforeEach } from "vitest";
import {
  listVisibleBlocks,
  listAllBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
  ensureDefaultBlocks,
} from "../api/queries/blocks";
import { resetDb, seedSiteContent } from "./helpers";

describe("blocks queries (SQLite)", () => {
  beforeEach(() => resetDb());

  it("returns empty list on a fresh database", async () => {
    await expect(listAllBlocks()).resolves.toEqual([]);
    await expect(listVisibleBlocks()).resolves.toEqual([]);
  });

  it("creates blocks appending to the end", async () => {
    const first = await createBlock({
      type: "text",
      data: { title: "История", text: "Текст", align: "left", narrow: true },
    });
    expect(first.id).toBe(1);
    expect(first.position).toBe(1);
    expect(first.isVisible).toBe(true);

    const second = await createBlock({
      type: "delivery",
      data: { title: "Доставка", text: "Быстро" },
    });
    expect(second.position).toBe(2);

    const all = await listAllBlocks();
    expect(all.map(b => b.type)).toEqual(["text", "delivery"]);
  });

  it("rejects unknown block type", async () => {
    await expect(createBlock({ type: "marquee", data: {} })).rejects.toThrow();
  });

  it("rejects invalid data per type", async () => {
    // cover без обязательных полей
    await expect(
      createBlock({ type: "cover", data: { title: "Привет" } })
    ).rejects.toThrow();
    // video со сторонним хостом
    await expect(
      createBlock({
        type: "video",
        data: { title: "", url: "https://evil.example.com/v" },
      })
    ).rejects.toThrow();
    // javascript:-URL в изображении
    await expect(
      createBlock({
        type: "image",
        data: { src: "javascript:alert(1)", caption: "", width: "large" },
      })
    ).rejects.toThrow();
    // protocol-relative путь
    await expect(
      createBlock({
        type: "image",
        data: { src: "//evil.example.com/a.png", caption: "", width: "large" },
      })
    ).rejects.toThrow();
  });

  it("accepts YouTube and Vimeo links", async () => {
    const yt = await createBlock({
      type: "video",
      data: { title: "", url: "https://www.youtube.com/watch?v=abc12345" },
    });
    expect(yt.type).toBe("video");
    const vimeo = await createBlock({
      type: "video",
      data: { title: "", url: "https://vimeo.com/123456789" },
    });
    expect(vimeo.type).toBe("video");
  });

  it("enforces singleton types", async () => {
    await createBlock({ type: "catalog", data: { title: "Каталог" } });
    await expect(
      createBlock({ type: "catalog", data: { title: "Ещё каталог" } })
    ).rejects.toThrow(/только один/);
    await createBlock({ type: "products", data: {} });
    await expect(createBlock({ type: "products", data: {} })).rejects.toThrow(
      /только один/
    );
  });

  it("updates data and visibility", async () => {
    const block = await createBlock({
      type: "faq",
      data: {
        title: "FAQ",
        items: [{ question: "Как?", answer: "Вот так" }],
      },
    });
    const updated = await updateBlock(block.id, {
      data: {
        title: "Вопросы",
        items: [{ question: "Где?", answer: "Там" }],
      },
      isVisible: false,
    });
    expect(updated.data).toEqual({
      title: "Вопросы",
      items: [{ question: "Где?", answer: "Там" }],
    });
    expect(updated.isVisible).toBe(false);
    await expect(listVisibleBlocks()).resolves.toEqual([]);
    await expect(listAllBlocks()).resolves.toHaveLength(1);
  });

  it("rejects invalid update data and unknown id", async () => {
    const block = await createBlock({
      type: "delivery",
      data: { title: "Доставка", text: "Текст" },
    });
    await expect(
      updateBlock(block.id, { data: { title: "Доставка" } })
    ).rejects.toThrow();
    await expect(updateBlock(999, { isVisible: true })).rejects.toThrow(
      /не найден/
    );
  });

  it("updates background color and resets it", async () => {
    const block = await createBlock({
      type: "text",
      data: { title: "A", text: "a", align: "left", narrow: true },
    });
    expect(block.background).toBeNull();
    const colored = await updateBlock(block.id, { background: "#5c2a2a" });
    expect(colored.background).toBe("#5c2a2a");
    const reset = await updateBlock(block.id, { background: null });
    expect(reset.background).toBeNull();
  });

  it("deletes a block", async () => {
    const block = await createBlock({
      type: "text",
      data: { title: "", text: "Текст", align: "left", narrow: true },
    });
    await deleteBlock(block.id);
    await expect(listAllBlocks()).resolves.toEqual([]);
  });

  it("reorders blocks and persists new positions", async () => {
    const a = await createBlock({
      type: "text",
      data: { title: "A", text: "a", align: "left", narrow: true },
    });
    const b = await createBlock({
      type: "text",
      data: { title: "B", text: "b", align: "left", narrow: true },
    });
    const c = await createBlock({
      type: "text",
      data: { title: "C", text: "c", align: "left", narrow: true },
    });
    const result = await reorderBlocks([c.id, a.id, b.id]);
    expect(result.map(block => block.id)).toEqual([c.id, a.id, b.id]);
    expect(result.map(block => block.position)).toEqual([1, 2, 3]);
  });

  it("rejects reorder with stale or duplicate ids", async () => {
    const a = await createBlock({
      type: "text",
      data: { title: "A", text: "a", align: "left", narrow: true },
    });
    const b = await createBlock({
      type: "text",
      data: { title: "B", text: "b", align: "left", narrow: true },
    });
    // Пропущен один блок
    await expect(reorderBlocks([a.id])).rejects.toThrow(/устарел/);
    // Повторы
    await expect(reorderBlocks([a.id, a.id])).rejects.toThrow(/повторяющиеся/);
    // Посторонний id
    await expect(reorderBlocks([a.id, 999])).rejects.toThrow(/устарел/);
    // Состав не изменился — порядок сохранился
    const result = await listAllBlocks();
    expect(result.map(block => block.id)).toEqual([a.id, b.id]);
  });

  it("ensureDefaultBlocks builds the starter layout from siteContent", async () => {
    await seedSiteContent();
    await ensureDefaultBlocks();
    const all = await listAllBlocks();
    expect(all.map(b => b.type)).toEqual([
      "cover",
      "about",
      "catalog",
      "products",
      "delivery",
    ]);
    const cover = all[0];
    if (cover.type !== "cover") throw new Error("expected cover block");
    expect(cover.data.title).toBe("Декор для дома ручной работы");
    expect(cover.data.text).toBe("test hero text");
    expect(cover.data.buttonLink).toBe("#catalog");
    const about = all[1];
    if (about.type !== "about") throw new Error("expected about block");
    expect(about.data.text).toBe("test about");
    // Повторный вызов ничего не добавляет
    await ensureDefaultBlocks();
    await expect(listAllBlocks()).resolves.toHaveLength(5);
  });

  it("ensureDefaultBlocks is a no-op without siteContent", async () => {
    await ensureDefaultBlocks();
    await expect(listAllBlocks()).resolves.toEqual([]);
  });

  it("replaces corrupted stored data with defaults", async () => {
    const block = await createBlock({
      type: "delivery",
      data: { title: "Доставка", text: "Текст" },
    });
    // Имитация повреждённой строки в БД
    const { getDb } = await import("../api/queries/connection");
    const { blocks } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(blocks)
      .set({ data: "{не json" })
      .where(eq(blocks.id, block.id));
    const [restored] = await listAllBlocks();
    if (restored.type !== "delivery") throw new Error("expected delivery");
    expect(restored.data.title).toBe("Доставка по всей России");
  });
});

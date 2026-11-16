import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { blockDefaults, MAX_BLOCKS } from "@contracts/blocks";
import app from "../api/boot";
import { blocksRouter } from "../api/blocks-router";
import { env } from "../api/lib/env";
import { ensureDefaultBlocks } from "../api/queries/blocks";
import { __resetDbForTests } from "../api/queries/connection";
import { securitySql } from "../api/queries/security-store";
import { resetDb, seedSiteContent } from "./helpers";

const context = {
  req: new Request(env.publicOrigin),
  resHeaders: new Headers(),
};
const visitor = blocksRouter.createCaller(context);
const admin = blocksRouter.createCaller({
  ...context,
  user: { authMethod: "telegram", telegramId: 100, role: "admin" },
});
const textBlock = {
  id: -102,
  type: "text",
  data: { ...blockDefaults("text"), title: "Пока только в черновике" },
  isVisible: true,
  background: "#abc",
} as const;

beforeEach(async () => {
  resetDb();
  await seedSiteContent();
  await ensureDefaultBlocks();
});

describe("home page draft", () => {
  it("copies an existing installation without rewriting published rows", async () => {
    resetDb();
    await seedSiteContent();
    await securitySql(
      "INSERT INTO blocks (id, type, position, isVisible, data, background) VALUES (?, ?, ?, ?, ?, ?)",
      [731, "text", 14, 0, JSON.stringify(textBlock.data), "#abc"]
    );
    const original = await securitySql("SELECT * FROM blocks");
    await ensureDefaultBlocks();
    expect(await securitySql("SELECT * FROM blocks")).toEqual(original);
    expect(await admin.draft.get()).toMatchObject({
      hasChanges: false,
      blocks: [
        { id: 731, position: 14, isVisible: false, data: textBlock.data },
      ],
    });
  });

  it("starts with the existing publication and keeps saved changes across initialization", async () => {
    const initial = await admin.draft.get();
    expect(initial.blocks).toEqual(await admin.listAll());
    expect(initial.hasChanges).toBe(false);
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [textBlock],
    });
    expect(saved.version).toBe(initial.version + 1);
    expect(saved.hasChanges).toBe(true);
    await ensureDefaultBlocks();
    expect(await admin.draft.get()).toEqual(saved);
    const restored = await admin.draft.restore({ version: saved.version });
    expect(restored.blocks).toEqual(initial.blocks);
    expect(restored.hasChanges).toBe(false);
  });

  it("keeps the snapshot and its version when the server reopens the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factura-drafts-"));
    const sqlitePath = env.sqlitePath;
    try {
      env.sqlitePath = join(directory, "draft.db");
      resetDb();
      await seedSiteContent();
      await ensureDefaultBlocks();
      const initial = await admin.draft.get();
      const saved = await admin.draft.save({
        version: initial.version,
        blocks: [textBlock],
      });
      __resetDbForTests();
      await ensureDefaultBlocks();
      expect(await admin.draft.get()).toEqual(saved);
    } finally {
      __resetDbForTests();
      env.sqlitePath = sqlitePath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps edits, visibility, deletions and reordered blocks out of the public API", async () => {
    const initial = await admin.draft.get();
    const [cover, about, catalog, products, delivery] = initial.blocks;
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [
        textBlock,
        { ...delivery, isVisible: false },
        catalog,
        { ...cover, data: { ...cover.data, title: "Другая обложка" } },
        products,
      ],
    });
    expect(saved.blocks.map(block => block.id)).toEqual([
      -102,
      delivery.id,
      catalog.id,
      cover.id,
      products.id,
    ]);
    expect(saved.blocks.some(block => block.id === about.id)).toBe(false);
    expect(await visitor.list()).toEqual(initial.blocks);
    const response = await app.request("/api/trpc/blocks.list");
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(textBlock.data.title);
  });

  it("publishes the full page, preserving old IDs and translating draft anchors", async () => {
    const initial = await admin.draft.get();
    const [cover, about] = initial.blocks;
    await securitySql("UPDATE siteContent SET navJson = ?", [
      JSON.stringify([
        { anchor: `#block-${about.id}`, label: "Старый", visible: true },
        { anchor: "#block--102", label: "Новый", visible: true },
      ]),
    ]);
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [
        textBlock,
        { ...about, background: "#ffffff", isVisible: false },
        {
          ...cover,
          data: {
            ...cover.data,
            buttonLink: "/#block--102",
            features: [{ icon: "hand", title: "Ручная работа" }],
          },
        },
      ],
    });
    expect((await admin.draft.get()).blocks[2].data).toMatchObject({
      features: [{ icon: "hand", title: "Ручная работа" }],
    });
    const published = await admin.draft.publish({ version: saved.version });
    const [newBlock, oldAbout, newCover] = published.blocks;
    expect(newBlock.id).toBeGreaterThan(0);
    expect(newBlock.background).toBe("#abc");
    expect(oldAbout).toMatchObject({
      id: about.id,
      position: 2,
      isVisible: false,
      background: "#ffffff",
    });
    expect(newCover).toMatchObject({
      id: cover.id,
      position: 3,
      data: {
        buttonLink: `/#block-${newBlock.id}`,
        features: [{ icon: "hand", title: "Ручная работа" }],
      },
    });
    expect(await visitor.list()).toEqual([newBlock, newCover]);
    expect(await admin.draft.get()).toEqual({
      ...published,
      hasChanges: false,
    });
    const [row] = await securitySql("SELECT navJson FROM siteContent");
    expect(
      JSON.parse(String(row.navJson)).map(
        (item: { anchor: string }) => item.anchor
      )
    ).toEqual([`#block-${about.id}`, `#block-${newBlock.id}`]);
  });

  it("keeps an empty draft and empty publication through repeated initialization", async () => {
    const initial = await admin.draft.get();
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [],
    });
    await ensureDefaultBlocks();
    expect(await admin.draft.get()).toEqual(saved);
    expect(await visitor.list()).toEqual(initial.blocks);
    const published = await admin.draft.publish({ version: saved.version });
    await ensureDefaultBlocks();
    expect(await visitor.list()).toEqual([]);
    expect(await admin.draft.get()).toEqual({
      ...published,
      blocks: [],
      hasChanges: false,
    });
  });

  it("rejects publication when a link targets a deleted temporary block", async () => {
    const initial = await admin.draft.get();
    const cover = initial.blocks[0];
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [
        { ...cover, data: { ...cover.data, buttonLink: "#block--102" } },
      ],
    });
    await expect(
      admin.draft.publish({ version: saved.version })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("#block--102"),
    });
    expect(await visitor.list()).toEqual(initial.blocks);
    expect(await admin.draft.get()).toEqual(saved);
  });

  it("rolls back new rows and earlier updates when publication fails", async () => {
    const initial = await admin.draft.get();
    const [cover, about] = initial.blocks;
    const saved = await admin.draft.save({
      version: initial.version,
      blocks: [textBlock, { ...cover, isVisible: false }, about],
    });
    await securitySql(`CREATE TRIGGER reject_publish BEFORE UPDATE ON blocks
      WHEN OLD.id = ${about.id} BEGIN SELECT RAISE(ABORT, 'publication failure'); END`);
    await expect(
      admin.draft.publish({ version: saved.version })
    ).rejects.toThrow("publication failure");
    expect(await admin.listAll()).toEqual(initial.blocks);
    expect(await admin.draft.get()).toEqual(saved);
  });

  it("accepts only one simultaneous write and rejects a stale publication or restore", async () => {
    const initial = await admin.draft.get();
    const [first, second] = await Promise.allSettled([
      admin.draft.save({ version: initial.version, blocks: [textBlock] }),
      admin.draft.save({ version: initial.version, blocks: [] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejection = first.status === "rejected" ? first : second;
    expect(rejection).toMatchObject({ reason: { code: "CONFLICT" } });
    await expect(
      admin.draft.publish({ version: initial.version })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      admin.draft.restore({ version: initial.version })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await visitor.list()).toEqual(initial.blocks);
  });

  it("validates draft size, IDs, singleton types, data and background on the server", async () => {
    const initial = await admin.draft.get();
    const catalog = {
      ...textBlock,
      type: "catalog" as const,
      data: blockDefaults("catalog"),
    };
    for (const blocks of [
      [textBlock, textBlock],
      [{ ...textBlock, id: 1000 }],
      [catalog, { ...catalog, id: -103 }],
      [{ ...textBlock, data: { ...textBlock.data, text: 123 } }],
      [{ ...textBlock, background: "red" }],
      Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
        ...textBlock,
        id: -i - 1,
      })),
    ]) {
      await expect(
        admin.draft.save({ version: initial.version, blocks })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await admin.draft.get()).toEqual(initial);
  });

  it("supports versioned operations for adding, updating, hiding, reordering and removing blocks", async () => {
    const initial = await admin.draft.get();
    const added = await admin.draft.create({
      version: initial.version,
      type: "text",
    });
    const id = added.blocks.at(-1)!.id;
    expect(id).toBeLessThan(0);
    const updated = await admin.draft.update({
      version: added.version,
      id,
      patch: { data: textBlock.data, isVisible: false },
    });
    const reordered = await admin.draft.reorder({
      version: updated.version,
      ids: updated.blocks.map(block => block.id).reverse(),
    });
    expect(reordered.blocks[0]).toMatchObject({
      id,
      isVisible: false,
      data: textBlock.data,
    });
    const deleted = await admin.draft.delete({
      version: reordered.version,
      id,
    });
    expect(deleted.blocks).toHaveLength(initial.blocks.length);
    expect(await visitor.list()).toEqual(initial.blocks);
  });

  it("requires administrator permission for reads, writes and previews", async () => {
    const restricted = blocksRouter.createCaller({
      ...context,
      user: { authMethod: "telegram", telegramId: 101, role: "viewer" },
    });
    const input = { version: 1, blocks: [textBlock] };
    await expect(visitor.draft.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(visitor.draft.save(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(restricted.draft.get()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(restricted.draft.save(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const response = await app.request("/api/trpc/blocks.draft.get");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

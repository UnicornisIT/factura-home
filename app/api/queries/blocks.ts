import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { insertAndReturn } from "./_shared";
import { securityTransaction } from "./security-store";
import { env } from "../lib/env";
import { blocks, siteContent } from "@db/schema";
import type { Block as BlockRow } from "@db/schema";
import {
  blockTypeSchema,
  validateBlockData,
  parseStoredBlockData,
} from "../lib/block-schemas";
import {
  MAX_BLOCKS,
  SINGLETON_BLOCK_TYPES,
  blockDefaults,
  type Block,
  type BlockType,
} from "@contracts/blocks";

function toApiBlock(row: BlockRow): Block | null {
  const type = blockTypeSchema.safeParse(row.type);
  if (!type.success) return null;
  return {
    id: row.id,
    type: type.data,
    position: row.position,
    isVisible: !!row.isVisible,
    background: row.background ?? null,
    data: parseStoredBlockData(type.data, row.data),
  } as Block;
}

function toApiBlocks(rows: BlockRow[]): Block[] {
  return rows
    .map(toApiBlock)
    .filter((block): block is Block => block !== null)
    .sort((a, b) => a.position - b.position);
}

async function selectAllOrdered(): Promise<BlockRow[]> {
  return getDb().select().from(blocks).orderBy(asc(blocks.position));
}

/** Видимые блоки для витрины. */
export async function listVisibleBlocks(): Promise<Block[]> {
  const rows: BlockRow[] = await getDb()
    .select()
    .from(blocks)
    .where(eq(blocks.isVisible, true))
    .orderBy(asc(blocks.position));
  return toApiBlocks(rows);
}

/** Все блоки, включая скрытые — для конструктора в админ-панели. */
export async function listAllBlocks(): Promise<Block[]> {
  return toApiBlocks(await selectAllOrdered());
}

export async function createBlock(input: {
  type: string;
  data?: unknown;
}): Promise<Block> {
  const type = blockTypeSchema.parse(input.type);
  const existing = await selectAllOrdered();
  if (existing.length >= MAX_BLOCKS)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Достигнут предел блоков на странице (${MAX_BLOCKS})`,
    });
  if (
    SINGLETON_BLOCK_TYPES.includes(type) &&
    existing.some(b => b.type === type)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Блок «Каталог», «Товары» или «Контакты» может быть только один",
    });
  const data = validateBlockData(type, input.data ?? blockDefaults(type));
  const position =
    existing.reduce((max, row) => Math.max(max, row.position), 0) + 1;
  const row = await insertAndReturn(blocks, {
    type,
    position,
    data: JSON.stringify(data),
  });
  const block = toApiBlock(row);
  if (!block) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  return block;
}

export async function updateBlock(
  id: number,
  input: { data?: unknown; isVisible?: boolean; background?: string | null }
): Promise<Block> {
  const [row] = await getDb().select().from(blocks).where(eq(blocks.id, id));
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Блок не найден" });
  const type = blockTypeSchema.parse(row.type);
  const update: Partial<Pick<BlockRow, "data" | "isVisible" | "background">> =
    {};
  if (input.data !== undefined)
    update.data = JSON.stringify(validateBlockData(type, input.data));
  if (input.isVisible !== undefined) update.isVisible = input.isVisible;
  if (input.background !== undefined)
    update.background = input.background || null;
  await getDb().update(blocks).set(update).where(eq(blocks.id, id));
  const [updated] = await getDb()
    .select()
    .from(blocks)
    .where(eq(blocks.id, id));
  const block = toApiBlock(updated);
  if (!block) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  return block;
}

export async function deleteBlock(id: number): Promise<void> {
  await getDb().delete(blocks).where(eq(blocks.id, id));
}

/**
 * Атомарно переназначает позиции: принимает полный список id блоков
 * в новом порядке. Если состав id не совпадает с базой (блок успели
 * добавить или удалить), изменение отклоняется целиком.
 */
export async function reorderBlocks(ids: number[]): Promise<Block[]> {
  if (ids.length > MAX_BLOCKS)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Слишком много блоков",
    });
  if (new Set(ids).size !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Список содержит повторяющиеся блоки",
    });
  await securityTransaction(async sql => {
    const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";
    const rows = await sql(`SELECT id FROM blocks${lock}`);
    const existing = rows.map(row => Number(row.id)).sort((a, b) => a - b);
    const provided = [...ids].sort((a, b) => a - b);
    if (
      existing.length !== provided.length ||
      existing.some((value, index) => value !== provided[index])
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Список блоков устарел — обновите страницу",
      });
    const stamp = env.dbDialect === "sqlite" ? "unixepoch()" : "NOW()";
    for (let index = 0; index < ids.length; index++)
      await sql(
        `UPDATE blocks SET position = ?, updatedAt = ${stamp} WHERE id = ?`,
        [index + 1, ids[index]]
      );
  });
  return listAllBlocks();
}

/**
 * Создаёт стартовый набор блоков из текущих текстов siteContent,
 * если таблица блоков пуста. Используется seed-скриптом на свежей базе
 * (миграция 002 к этому моменту уже отработала впустую).
 */
export async function ensureDefaultBlocks(): Promise<void> {
  const existing = await selectAllOrdered();
  if (existing.length > 0) return;
  const db = getDb();
  const [content] = await db.select().from(siteContent).limit(1);
  if (!content) return;
  const defaults: { type: BlockType; data: unknown }[] = [
    {
      type: "cover",
      data: {
        ...blockDefaults("cover"),
        // Стартовые тексты магазина важнее шаблонных; фото администратор
        // загружает сам, до этого в арке остаётся декоративная заглушка.
        eyebrow: undefined,
        title: content.heroTitle,
        text: content.heroText,
        buttonText: "Каталог",
        buttonLink: "#catalog",
        backgroundImage: "",
        align: "center",
        image: "",
      },
    },
    {
      type: "about",
      data: {
        title: content.aboutTitle,
        text: content.aboutText,
        image: content.aboutImage ?? "",
      },
    },
    { type: "catalog", data: blockDefaults("catalog") },
    { type: "products", data: blockDefaults("products") },
    {
      type: "delivery",
      data: { title: content.deliveryTitle, text: content.deliveryText },
    },
    { type: "contacts", data: blockDefaults("contacts") },
  ];
  let position = 1;
  for (const item of defaults) {
    const data = validateBlockData(item.type, item.data);
    await db.insert(blocks).values({
      type: item.type,
      position: position++,
      data: JSON.stringify(data),
    });
  }
}

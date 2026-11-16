import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import {
  runSqlTransaction,
  securitySql,
  type SqlTransaction,
} from "./security-store";
import { env } from "../lib/env";
import { blocks } from "@db/schema";
import type { Block as BlockRow, SiteContent } from "@db/schema";
import {
  blockTypeSchema,
  backgroundColorSchema,
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

type StoredBlock = Pick<BlockRow, "type" | "data" | "background"> & {
  id: number | string;
  position: number;
  isVisible: boolean | number;
};

function toApiBlock(row: StoredBlock): Block | null {
  const type = blockTypeSchema.safeParse(row.type);
  if (!type.success) return null;
  return {
    id: Number(row.id),
    type: type.data,
    position: row.position,
    isVisible: !!row.isVisible,
    background: row.background ?? null,
    data: parseStoredBlockData(type.data, row.data),
  } as Block;
}

function toApiBlocks(rows: StoredBlock[]): Block[] {
  return rows
    .map(toApiBlock)
    .filter((block): block is Block => block !== null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
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

/** Полная опубликованная версия, включая скрытые блоки. */
export async function listAllBlocks(): Promise<Block[]> {
  const rows: BlockRow[] = await getDb()
    .select()
    .from(blocks)
    .orderBy(asc(blocks.position));
  return toApiBlocks(rows);
}

// Первичная настройка выполняется при миграции или после загрузки текстов.
export async function ensureDefaultBlocks(): Promise<void> {
  await runSqlTransaction(() => initializeDraft(false));
}

function* addDefaultBlocks(
  content: Pick<
    SiteContent,
    | "heroTitle"
    | "heroText"
    | "aboutTitle"
    | "aboutText"
    | "aboutImage"
    | "deliveryTitle"
    | "deliveryText"
  >
): SqlTransaction<void> {
  const defaults: { type: BlockType; data: unknown }[] = [
    {
      type: "cover",
      data: {
        ...blockDefaults("cover"),
        // Стартовый набор должен использовать тексты текущего магазина.
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
    yield [
      "INSERT INTO blocks (type, position, data) VALUES (?, ?, ?)",
      [item.type, position++, JSON.stringify(data)],
    ];
  }
}

type HomeDraft = {
  version: number;
  blocks: Block[];
  hasChanges: boolean;
};

const mysql = env.dbDialect === "mysql";
const lockRow = mysql ? " FOR UPDATE" : "";
const stamp = mysql ? "NOW()" : "unixepoch()";

function* publishedBlocks(): SqlTransaction<Block[]> {
  const rows = yield [
    "SELECT id, type, position, isVisible, data, background FROM blocks ORDER BY position, id",
  ];
  return toApiBlocks(rows as StoredBlock[]);
}

function initializeDraft(required: true): SqlTransaction<HomeDraft>;
function initializeDraft(
  required: false
): SqlTransaction<HomeDraft | undefined>;
function* initializeDraft(
  required: boolean
): SqlTransaction<HomeDraft | undefined> {
  // The singleton row serializes initialization and every edit in MySQL.
  yield [
    mysql
      ? "INSERT INTO homePageDraft VALUES (1, 0, '[]', 0) ON DUPLICATE KEY UPDATE id = id"
      : "INSERT INTO homePageDraft VALUES (1, 0, '[]', 0) ON CONFLICT(id) DO NOTHING",
  ];
  const [row] = yield [
    `SELECT version, snapshot, hasChanges FROM homePageDraft WHERE id = 1${lockRow}`,
  ];
  const version = Number(row.version);
  if (version > 0) return decodeDraft(row);

  let blocks = yield* publishedBlocks();
  if (!blocks.length) {
    const [content] = yield [
      "SELECT heroTitle, heroText, aboutTitle, aboutText, aboutImage, deliveryTitle, deliveryText FROM siteContent LIMIT 1",
    ];
    if (!required && content) {
      yield* addDefaultBlocks(
        content as Parameters<typeof addDefaultBlocks>[0]
      );
      blocks = yield* publishedBlocks();
    } else if (!required) {
      // Migration can run before the initial texts are seeded.
      yield ["DELETE FROM homePageDraft WHERE id = 1"];
      return;
    }
  }
  return yield* storeDraft(version, blocks, false);
}

function* storeDraft(
  version: number,
  blocks: Block[],
  hasChanges: boolean
): SqlTransaction<HomeDraft> {
  const next = { version: version + 1, blocks, hasChanges };
  yield [
    "UPDATE homePageDraft SET version = ?, snapshot = ?, hasChanges = ? WHERE id = 1",
    [next.version, JSON.stringify(blocks), Number(hasChanges)],
  ];
  return next;
}

function decodeDraft(row: Record<string, unknown>): HomeDraft {
  return {
    version: Number(row.version),
    blocks: JSON.parse(String(row.snapshot)) as Block[],
    hasChanges: Boolean(row.hasChanges),
  };
}

export async function getHomeDraft(): Promise<HomeDraft> {
  const [row] = await securitySql(
    "SELECT version, snapshot, hasChanges FROM homePageDraft WHERE id = 1"
  );
  return row
    ? decodeDraft(row)
    : runSqlTransaction(() => initializeDraft(true));
}

function* versionedDraft(version: number): SqlTransaction<HomeDraft> {
  const draft = yield* initializeDraft(true);
  if (draft.version !== version)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Черновик изменился. Загрузите актуальную версию перед продолжением.",
    });
  return draft;
}

export type DraftBlockInput = {
  id: number;
  type: BlockType;
  isVisible: boolean;
  background: string | null;
  data: unknown;
};

function validateSnapshot(input: DraftBlockInput[], allowed: Block[]): Block[] {
  const existing = new Map(allowed.map(block => [block.id, block.type]));
  const ids = new Set<number>();
  const singletons = new Set<BlockType>();
  if (input.length > MAX_BLOCKS)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Достигнут предел блоков на странице (${MAX_BLOCKS})`,
    });
  return input.map((block, index) => {
    const type = blockTypeSchema.parse(block.type);
    if (ids.has(block.id) || (block.id > 0 && existing.get(block.id) !== type))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Некорректный идентификатор блока",
      });
    ids.add(block.id);
    if (SINGLETON_BLOCK_TYPES.includes(type)) {
      if (singletons.has(type))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Блок «Каталог», «Товары» или «Контакты» может быть только один",
        });
      singletons.add(type);
    }
    return {
      id: block.id,
      type,
      position: index + 1,
      isVisible: block.isVisible,
      background: backgroundColorSchema.nullable().parse(block.background),
      data: validateBlockData(type, block.data),
    } as Block;
  });
}

export function editHomeDraft(
  version: number,
  edit: (blocks: Block[]) => DraftBlockInput[]
): Promise<HomeDraft> {
  return runSqlTransaction(function* () {
    const draft = yield* versionedDraft(version);
    const blocks = validateSnapshot(edit(draft.blocks), draft.blocks);
    const published = yield* publishedBlocks();
    return yield* storeDraft(
      version,
      blocks,
      JSON.stringify(blocks) !== JSON.stringify(published)
    );
  });
}

export function restoreHomeDraft(version: number): Promise<HomeDraft> {
  return runSqlTransaction(function* () {
    yield* versionedDraft(version);
    return yield* storeDraft(version, yield* publishedBlocks(), false);
  });
}

function remapAnchor(link: string, ids: Map<string, string>) {
  const hash = link.indexOf("#");
  if (hash < 0) return link;
  const path = link.slice(0, hash);
  if (
    path &&
    path !== "/" &&
    path !== `${env.publicOrigin}/` &&
    path !== env.publicOrigin
  )
    return link;
  const target = link.slice(hash);
  const anchor = ids.get(target);
  if (!anchor && /^#block--\d+$/.test(target))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Якорь ${target} ссылается на удалённый блок. Исправьте ссылку перед публикацией.`,
    });
  return anchor ? path + anchor : link;
}

function* remapNavigation(ids: Map<string, string>): SqlTransaction<void> {
  const rows = yield [`SELECT id, navJson FROM siteContent${lockRow}`];
  for (const row of rows) {
    const raw = String(row.navJson);
    let items: unknown;
    try {
      items = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    let changed = false;
    for (const item of items) {
      if (typeof item?.anchor !== "string") continue;
      const anchor = remapAnchor(item.anchor, ids);
      if (anchor === item.anchor) continue;
      item.anchor = anchor;
      changed = true;
    }
    if (changed)
      yield [
        "UPDATE siteContent SET navJson = ? WHERE id = ?",
        [JSON.stringify(items), Number(row.id)],
      ];
  }
}

export function publishHomeDraft(version: number): Promise<HomeDraft> {
  return runSqlTransaction(function* () {
    const draft = yield* versionedDraft(version);
    if (!draft.hasChanges) return draft;
    const published = yield* publishedBlocks();
    const next = validateSnapshot(draft.blocks, published);
    const retained = new Set(next.map(block => block.id));
    const remapped = new Map<string, string>();
    for (const block of next) {
      if (block.id > 0) continue;
      yield [
        "INSERT INTO blocks (type, position, isVisible, background, data) VALUES (?, ?, ?, ?, ?)",
        [
          block.type,
          block.position,
          Number(block.isVisible),
          block.background,
          JSON.stringify(block.data),
        ],
      ];
      const [row] = yield [
        mysql
          ? "SELECT LAST_INSERT_ID() AS id"
          : "SELECT last_insert_rowid() AS id",
      ];
      const id = Number(row.id);
      if (!Number.isSafeInteger(id))
        throw new Error("Block identifier exceeds safe integer range");
      remapped.set(`#block-${block.id}`, `#block-${id}`);
      block.id = id;
    }
    for (const block of next) {
      if (block.type === "cover")
        block.data.buttonLink = remapAnchor(block.data.buttonLink, remapped);
      yield [
        `UPDATE blocks SET position = ?, isVisible = ?, background = ?, data = ?, updatedAt = ${stamp} WHERE id = ?`,
        [
          block.position,
          Number(block.isVisible),
          block.background,
          JSON.stringify(block.data),
          block.id,
        ],
      ];
    }
    for (const block of published)
      if (!retained.has(block.id))
        yield ["DELETE FROM blocks WHERE id = ?", [block.id]];
    yield* remapNavigation(remapped);
    return yield* storeDraft(version, next, false);
  });
}

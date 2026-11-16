import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import {
  listVisibleBlocks,
  listAllBlocks,
  getHomeDraft,
  editHomeDraft,
  restoreHomeDraft,
  publishHomeDraft,
} from "./queries/blocks";
import { blockTypeSchema, backgroundColorSchema } from "./lib/block-schemas";
import {
  blockDefaults,
  createTemporaryBlockId,
  MAX_BLOCKS,
} from "@contracts/blocks";

const versioned = z.object({ version: z.number().int().positive() });
const blockId = z
  .number()
  .int()
  .refine(id => id !== 0);
const blockData = z.record(z.string(), z.unknown());
const patch = z.object({
  isVisible: z.boolean(),
  background: backgroundColorSchema.nullable(),
  data: blockData,
});
const draftBlock = patch.extend({ id: blockId, type: blockTypeSchema });

const draftRouter = createRouter({
  get: adminQuery.query(() => getHomeDraft()),
  save: adminQuery
    .input(versioned.extend({ blocks: z.array(draftBlock).max(MAX_BLOCKS) }))
    .mutation(({ input }) => editHomeDraft(input.version, () => input.blocks)),
  create: adminQuery
    .input(
      versioned.extend({ type: blockTypeSchema, data: blockData.optional() })
    )
    .mutation(({ input }) =>
      editHomeDraft(input.version, blocks => [
        ...blocks,
        {
          id: createTemporaryBlockId(blocks),
          type: input.type,
          data: input.data ?? blockDefaults(input.type),
          isVisible: true,
          background: null,
        },
      ])
    ),
  update: adminQuery
    .input(versioned.extend({ id: blockId, patch: patch.partial() }))
    .mutation(({ input }) =>
      editHomeDraft(input.version, blocks => {
        if (!blocks.some(block => block.id === input.id))
          throw new TRPCError({ code: "NOT_FOUND", message: "Блок не найден" });
        return blocks.map(block =>
          block.id === input.id ? { ...block, ...input.patch } : block
        );
      })
    ),
  delete: adminQuery
    .input(versioned.extend({ id: blockId }))
    .mutation(({ input }) =>
      editHomeDraft(input.version, blocks =>
        blocks.filter(block => block.id !== input.id)
      )
    ),
  reorder: adminQuery
    .input(versioned.extend({ ids: z.array(blockId).max(MAX_BLOCKS) }))
    .mutation(({ input }) =>
      editHomeDraft(input.version, blocks => {
        const byId = new Map(blocks.map(block => [block.id, block]));
        if (
          input.ids.length !== blocks.length ||
          new Set(input.ids).size !== blocks.length ||
          input.ids.some(id => !byId.has(id))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Нужен полный список блоков без повторов",
          });
        return input.ids.map(id => byId.get(id)!);
      })
    ),
  restore: adminQuery
    .input(versioned)
    .mutation(({ input }) => restoreHomeDraft(input.version)),
  publish: adminQuery
    .input(versioned)
    .mutation(({ input }) => publishHomeDraft(input.version)),
});

export const blocksRouter = createRouter({
  list: publicQuery.query(() => listVisibleBlocks()),
  listAll: adminQuery.query(() => listAllBlocks()),
  draft: draftRouter,
});

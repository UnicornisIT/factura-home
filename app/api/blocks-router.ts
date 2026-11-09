import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import {
  listVisibleBlocks,
  listAllBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
} from "./queries/blocks";
import { blockTypeSchema, backgroundColorSchema } from "./lib/block-schemas";
import { MAX_BLOCKS } from "@contracts/blocks";

export const blocksRouter = createRouter({
  /** Видимые блоки главной страницы — для витрины. */
  list: publicQuery.query(() => listVisibleBlocks()),

  /** Все блоки, включая скрытые — для конструктора в админ-панели. */
  listAll: adminQuery.query(() => listAllBlocks()),

  create: adminQuery
    .input(
      z.object({
        type: blockTypeSchema,
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) => createBlock(input)),

  update: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        data: z.record(z.string(), z.unknown()).optional(),
        isVisible: z.boolean().optional(),
        background: backgroundColorSchema.nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return updateBlock(id, patch);
    }),

  delete: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => deleteBlock(input.id)),

  /** Полный список id блоков в новом порядке. */
  reorder: adminQuery
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(MAX_BLOCKS),
      })
    )
    .mutation(({ input }) => reorderBlocks(input.ids)),
});

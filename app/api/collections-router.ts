import { imageUrl } from "./lib/validation";
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
} from "./queries/collections";

export const collectionsRouter = createRouter({
  list: publicQuery.query(() => listCollections()),

  create: adminQuery
    .input(
      z.object({
        slug: z.string().min(1).max(100),
        title: z.string().min(1).max(255),
        coverImage: imageUrl.nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(({ input }) => createCollection(input)),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        slug: z.string().min(1).max(100).optional(),
        title: z.string().min(1).max(255).optional(),
        coverImage: imageUrl.nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateCollection(id, data);
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteCollection(input.id)),
});

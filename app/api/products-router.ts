import { imageUrl } from "./lib/validation";
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import {
  listProducts,
  listAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from "./queries/products";

export const productsRouter = createRouter({
  list: publicQuery.query(() => listProducts()),
  listAll: adminQuery.query(() => listAllProducts()),

  create: adminQuery
    .input(
      z.object({
        collectionId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        name: z.string().min(1).max(255),
        material: z.string().max(255).optional(),
        price: z.number().int().positive().max(10000000),
        image: imageUrl.nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(({ input }) => createProduct(input)),

  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        collectionId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        name: z.string().min(1).max(255).optional(),
        material: z.string().max(255).optional(),
        price: z.number().int().positive().max(10000000).optional(),
        image: imageUrl.nullable().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...data } = input;
      return updateProduct(id, data);
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteProduct(input.id)),
});

import { consumeRateLimit } from "./lib/rate-limit";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import {
  createOrder,
  listOrders,
  countNewOrders,
  updateOrderStatus,
  deleteOrder,
} from "./queries/orders";

export const ordersRouter = createRouter({
  create: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        contact: z.string().trim().min(1).max(320),
        comment: z.string().max(2000).optional(),
        items: z
          .array(
            z.object({
              productId: z
                .number()
                .int()
                .positive()
                .max(Number.MAX_SAFE_INTEGER),
              qty: z.number().int().min(1).max(50),
            })
          )
          .min(1)
          .max(50),
      })
    )
    .mutation(async ({ input }) => {
      if (
        !(await consumeRateLimit(
          "checkout:" + input.contact.toLowerCase(),
          5,
          600000
        ))
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Слишком много заказов. Попробуйте позже",
        });
      return createOrder(input);
    }),

  list: adminQuery.query(() => listOrders()),
  newCount: adminQuery.query(() => countNewOrders()),

  updateStatus: adminQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["new", "in_progress", "shipped", "done"]),
      })
    )
    .mutation(({ input }) => updateOrderStatus(input.id, input.status)),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteOrder(input.id)),
});

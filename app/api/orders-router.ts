import { consumeRateLimit } from "./lib/rate-limit";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_ORDER_ITEM_QUANTITY } from "@contracts/constants";
import {
  contactDetailsSchema,
  contactMethods,
  orderHoneypotSchema,
  orderNameSchema,
  parseLegacyContact,
} from "@contracts/order-contacts";
import { createRouter, limitedMutation, adminQuery } from "./middleware";
import {
  createOrder,
  findOrderByRequestKey,
  listOrders,
  countNewOrders,
  updateOrderStatus,
  deleteOrder,
} from "./queries/orders";

export const ordersRouter = createRouter({
  create: limitedMutation
    .input(
      z
        .object({
          name: orderNameSchema,
          contact: z.string().trim().min(1).max(320).optional(),
          contactDetails: contactDetailsSchema.optional(),
          requestId: z.uuidv4().optional(),
          honeypot: orderHoneypotSchema,
          comment: z.string().max(2000).optional(),
          items: z
            .array(
              z.object({
                productId: z
                  .number()
                  .int()
                  .positive()
                  .max(Number.MAX_SAFE_INTEGER),
                qty: z.number().int().min(1).max(MAX_ORDER_ITEM_QUANTITY),
              })
            )
            .min(1)
            .max(50),
        })
        .transform((input, ctx) => {
          const contactDetails =
            input.contactDetails ??
            (input.contact && parseLegacyContact(input.contact));
          if (
            !contactDetails ||
            (input.contactDetails && input.contact !== undefined)
          ) {
            ctx.issues.push({
              code: "custom",
              input,
              path: ["contactDetails"],
              message: "Укажите корректные способы связи",
            });
            return z.NEVER;
          }
          return { ...input, contactDetails };
        })
    )
    .mutation(async ({ input }) => {
      const { contactDetails } = input;
      const requestKey =
        input.requestId &&
        createHash("sha256")
          .update(input.requestId.toLowerCase())
          .digest("hex");
      const existing = requestKey && (await findOrderByRequestKey(requestKey));
      if (existing) return existing;

      for (const method of contactMethods) {
        const value = contactDetails[method];
        if (!value) continue;
        const identity =
          method === "telegram"
            ? `@${value}`
            : method === "phone"
              ? value.replace(/^\+/, "")
              : value;
        if (
          !(await consumeRateLimit(
            "checkout:" + identity.toLowerCase(),
            5,
            600000
          ))
        )
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Слишком много заказов. Попробуйте позже",
          });
      }

      const { preferred } = contactDetails;
      return createOrder({
        ...input,
        contact:
          (preferred === "telegram" ? "@" : "") + contactDetails[preferred],
        contactDetails,
        requestKey,
      });
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

import { securityTransaction, audit } from "./queries/security-store";
import { telegramAuthRouter } from "./telegram-auth-router";
import { adminAllowlistRouter } from "./admin-allowlist-router";
import { collectionsRouter } from "./collections-router";
import { productsRouter } from "./products-router";
import { ordersRouter } from "./orders-router";
import { contentRouter } from "./content-router";
import { createRouter, publicQuery } from "./middleware";
import { revokeSession, setSessionCookie } from "./session";
const authRouter = createRouter({
  me: publicQuery.query(({ ctx }) => {
    if (!ctx.user) return null;
    return {
      authMethod: ctx.user.authMethod,
      role: ctx.user.role,
      telegramId: ctx.user.telegramId ?? null,
      displayName: ctx.user.displayName ?? null,
      photoUrl: ctx.user.photoUrl ?? null,
    };
  }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    await securityTransaction(async sql => {
      await revokeSession(ctx.req, sql);
      if (ctx.user)
        await audit(
          sql,
          ctx.user.telegramId,
          "logout",
          ctx.user.telegramId,
          null,
          null
        );
    });
    setSessionCookie(ctx.resHeaders, "");
    return { success: true };
  }),

  telegram: telegramAuthRouter,
});

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  auth: authRouter,
  allowlist: adminAllowlistRouter,

  collections: collectionsRouter,
  products: productsRouter,
  orders: ordersRouter,
  content: contentRouter,
});

export type AppRouter = typeof appRouter;

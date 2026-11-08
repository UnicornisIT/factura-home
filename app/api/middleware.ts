import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { audit, securitySql } from "./queries/security-store";
import { env } from "./lib/env";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const data = { ...shape.data };
    if (env.isProduction) delete data.stack;
    return {
      ...shape,
      data,
      message:
        env.isProduction && error.code === "INTERNAL_SERVER_ERROR"
          ? "Internal Server Error"
          : shape.message,
    };
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(allowedRoles: string[]) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !allowedRoles.includes(ctx.user.role)) {
      if (ctx.user)
        await audit(
          securitySql,
          ctx.user.telegramId,
          opts.path,
          null,
          null,
          null,
          "denied"
        );
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
const logMutation = t.middleware(async ({ ctx, next, type, path }) => {
  const result = await next();
  if (type === "mutation" && ctx.user)
    await audit(
      securitySql,
      ctx.user.telegramId,
      path,
      null,
      null,
      null,
      result.ok ? "success" : "failed"
    );
  return result;
});
export const adminQuery = authedQuery
  .use(requireRole(["admin", "super_admin"]))
  .use(logMutation);

export const superAdminQuery = authedQuery.use(requireRole(["super_admin"]));

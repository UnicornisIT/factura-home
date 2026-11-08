import { z } from "zod";

import { createRouter, superAdminQuery } from "./middleware";

import { listAllowlist, changeAccess } from "./queries/admin-allowlist";

import { securitySql } from "./queries/security-store";

import { env } from "./lib/env";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const adminAllowlistRouter = createRouter({
  list: superAdminQuery.query(async () =>
    (await listAllowlist()).map(row => ({
      ...row,
      isOwner: row.telegramId === env.superAdminTelegramId,
    }))
  ),

  audit: superAdminQuery.query(() =>
    securitySql("SELECT * FROM adminAuditLog ORDER BY id DESC LIMIT 200")
  ),

  add: superAdminQuery
    .input(
      z.object({
        telegramId: id,
        role: z.enum(["admin", "super_admin"]).default("admin"),
      })
    )
    .mutation(({ input, ctx }) =>
      changeAccess(ctx.user.telegramId!, input.telegramId, "add", input.role)
    ),

  deactivate: superAdminQuery
    .input(z.object({ telegramId: id }))
    .mutation(async ({ input, ctx }) => {
      await changeAccess(ctx.user.telegramId!, input.telegramId, "deactivate");
      return { success: true };
    }),

  updateRole: superAdminQuery
    .input(z.object({ telegramId: id, role: z.enum(["admin", "super_admin"]) }))
    .mutation(({ input, ctx }) =>
      changeAccess(ctx.user.telegramId!, input.telegramId, "role", input.role)
    ),
});

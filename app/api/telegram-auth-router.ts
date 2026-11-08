import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { createRouter, publicQuery } from "./middleware";

import { verifyTelegramAuth } from "./lib/telegram-auth";

import { issueSession, revokeSession, setSessionCookie } from "./session";

import { securityTransaction, audit } from "./queries/security-store";

import { env } from "./lib/env";

const schema = z
  .object({
    id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),

    first_name: z.string().max(256).optional(),
    last_name: z.string().max(256).optional(),

    username: z.string().max(64).optional(),
    photo_url: z.string().url().max(2048).optional(),

    auth_date: z.coerce.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const telegramAuthRouter = createRouter({
  widgetConfig: publicQuery.query(() => ({ botName: env.telegramBotName })),

  verify: publicQuery.input(schema).mutation(async ({ input, ctx }) => {
    if (!verifyTelegramAuth(input).ok)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Не удалось подтвердить вход через Telegram",
      });

    const result = await securityTransaction(async sql => {
      const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";

      const [entry] = await sql(
        `SELECT * FROM adminAllowlist WHERE telegramId = ?${lock}`,
        [input.id]
      );

      if (!entry?.isActive) {
        await audit(sql, input.id, "login", input.id, null, null, "denied");

        return { error: "Доступ запрещён" };
      }

      await sql("DELETE FROM telegramAuthReplay WHERE expiresAt <= ?", [
        Date.now(),
      ]);

      const [used] = await sql(
        "SELECT hash FROM telegramAuthReplay WHERE hash = ?",
        [input.hash]
      );

      if (used)
        return { error: "Вход уже использован. Повторите вход через Telegram" };

      await sql(
        "INSERT INTO telegramAuthReplay (hash, expiresAt) VALUES (?, ?)",
        [input.hash, (input.auth_date + 3601) * 1000]
      );

      await revokeSession(ctx.req, sql);

      const token = await issueSession(sql, {
        authMethod: "telegram",
        role: entry.role as string,
        telegramId: input.id,
        username: input.username,
        firstName: input.first_name,
        photoUrl: input.photo_url,
      });

      await audit(sql, input.id, "login", input.id, null, entry.role as string);

      return { token };
    });

    if (!result.token)
      throw new TRPCError({ code: "FORBIDDEN", message: result.error });

    setSessionCookie(ctx.resHeaders, result.token);

    return { success: true };
  }),
});

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminQuery, createRouter } from "./middleware";
import { env } from "./lib/env";
import { telegramSettings, testTelegramChat } from "./lib/telegram-settings";
import { notificationPreference } from "./queries/order-notifications";
import { securityTransaction } from "./queries/security-store";

async function getPreference(telegramId: number) {
  const enabled = await notificationPreference(telegramId);
  if (enabled === undefined)
    throw new TRPCError({ code: "FORBIDDEN", message: "Доступ запрещён" });
  return enabled;
}

const sendTest = (telegramId: number) =>
  testTelegramChat(telegramId, "order", getPreference);

export const orderNotificationsRouter = createRouter({
  settings: adminQuery.query(async ({ ctx }) =>
    telegramSettings(await getPreference(ctx.user.telegramId))
  ),
  setEnabled: adminQuery
    .input(z.object({ enabled: z.boolean() }).strict())
    .mutation(async ({ input, ctx }) => {
      const { telegramId } = ctx.user;
      if (input.enabled) await sendTest(telegramId);
      await securityTransaction(async sql => {
        const lock = env.dbDialect === "mysql" ? " FOR UPDATE" : "";
        const [admin] = await sql(
          `SELECT id FROM adminAllowlist
           WHERE telegramId = ? AND isActive = 1 AND role IN ('admin', 'super_admin')${lock}`,
          [telegramId]
        );
        if (!admin)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Доступ запрещён",
          });
        if (!input.enabled) {
          await sql(
            "DELETE FROM orderTelegramSubscriptions WHERE telegramId = ?",
            [telegramId]
          );
        } else {
          const conflict =
            env.dbDialect === "mysql"
              ? "ON DUPLICATE KEY UPDATE telegramId = telegramId"
              : "ON CONFLICT(telegramId) DO NOTHING";
          await sql(
            `INSERT INTO orderTelegramSubscriptions (telegramId, subscriptionKey) VALUES (?, ?) ${conflict}`,
            [telegramId, randomUUID()]
          );
        }
      });
      return { enabled: input.enabled };
    }),
  test: adminQuery.mutation(async ({ ctx }) => {
    await sendTest(ctx.user.telegramId);
    return { sent: true };
  }),
});

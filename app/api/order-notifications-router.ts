import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminQuery, createRouter } from "./middleware";
import { env } from "./lib/env";
import { consumeRateLimit } from "./lib/rate-limit";
import { sendTelegramMessage } from "./lib/order-telegram";
import { notificationPreference } from "./queries/order-notifications";
import { securityTransaction } from "./queries/security-store";

const botName = env.telegramBotName.replace(/^@/, "");
const botUrl = /^[A-Za-z0-9_]{5,32}$/.test(botName)
  ? `https://t.me/${botName}`
  : null;

async function getPreference(telegramId: number) {
  const enabled = await notificationPreference(telegramId);
  if (enabled === undefined)
    throw new TRPCError({ code: "FORBIDDEN", message: "Доступ запрещён" });
  return enabled;
}

async function sendTest(telegramId: number) {
  if (!env.telegramBotToken || !botUrl)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Бот для уведомлений не настроен",
    });
  if (!(await consumeRateLimit(`order-notifications:${telegramId}`, 5, 60_000)))
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Слишком много проверок. Попробуйте через минуту.",
    });

  await getPreference(telegramId);
  const result = await sendTelegramMessage(
    telegramId,
    "Проверка связи: бот Factura Home может отправлять вам уведомления о заказах."
  );
  if (result.kind !== "sent")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        result.kind === "chat_unavailable"
          ? "Откройте бота в Telegram, разблокируйте его при необходимости и нажмите /start. Затем повторите попытку."
          : "Не удалось отправить сообщение в Telegram. Попробуйте позже.",
    });
}

export const orderNotificationsRouter = createRouter({
  settings: adminQuery.query(async ({ ctx }) => ({
    enabled: await getPreference(ctx.user.telegramId),
    configured: Boolean(env.telegramBotToken && botUrl),
    botUrl,
  })),
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

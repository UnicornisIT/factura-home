import { TRPCError } from "@trpc/server";
import { env } from "./env";
import { sendTelegramMessage } from "./order-telegram";
import { consumeRateLimit } from "./rate-limit";

const botName = env.telegramBotName.replace(/^@/, "");
const botUrl = /^[A-Za-z0-9_]{5,32}$/.test(botName)
  ? `https://t.me/${botName}`
  : null;

export function telegramSettings(enabled: boolean) {
  return {
    enabled,
    configured: Boolean(env.telegramBotToken && botUrl),
    botUrl,
  };
}

export async function testTelegramChat(
  telegramId: number,
  topic: "order" | "update",
  checkAccess: (id: number) => Promise<boolean>
) {
  if (!env.telegramBotToken || !botUrl)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Бот для уведомлений не настроен",
    });
  if (
    !(await consumeRateLimit(`${topic}-notifications:${telegramId}`, 5, 60_000))
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Слишком много проверок. Попробуйте через минуту.",
    });

  await checkAccess(telegramId);
  const result = await sendTelegramMessage(
    telegramId,
    `Проверка связи: бот Factura Home может отправлять вам уведомления о ${topic === "order" ? "заказах" : "обновлениях"}.`
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

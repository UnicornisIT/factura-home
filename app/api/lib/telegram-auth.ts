import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Данные, которые Telegram Login Widget отправляет в колбэк `data-onauth`.
 * Все поля, кроме `hash`, участвуют в data-check-string при верификации.
 *
 * Документация: https://core.telegram.org/widgets/login#checking-authorization
 */
export interface TelegramAuthData {
  id: number; // Telegram user id (int64)
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number; // Unix seconds
  hash: string; // HMAC-SHA256 сигнатура
}

/**
 * Допустимое окно устаревания auth_date. Telegram рекомендует проверять,
 * что auth_date свежий, иначе устаревший authData может быть переиспользован.
 * 1 час — разумный компромисс между безопасностью и user experience.
 */
const MAX_AUTH_AGE_SECONDS = 60 * 60;

/**
 * Проверяет подпись Telegram Login Widget.
 *
 * Алгоритм (см. ссылку выше):
 *   1. Исключить поле `hash` из данных.
 *   2. Отсортировать оставшиеся пары key=value по ключу алфавитно.
 *   3. Склеить в data-check-string через "\n".
 *   4. secret_key = SHA256(bot_token)
 *   5. hash = HMAC-SHA256(secret_key, data-check-string), hex.
 *   6. Сравнить с присланной `hash` (constant-time).
 *
 * Дополнительно проверяет, что auth_date не старее MAX_AUTH_AGE_SECONDS.
 */
export function verifyTelegramAuth(
  authData: TelegramAuthData,
  botToken: string = env.telegramBotToken
): { ok: true } | { ok: false; reason: string } {
  if (!botToken) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN is not configured" };
  }

  const { hash, ...rest } = authData;
  if (
    !Number.isSafeInteger(authData.id) ||
    authData.id <= 0 ||
    !Number.isSafeInteger(authData.auth_date) ||
    authData.auth_date <= 0 ||
    !/^[a-f0-9]{64}$/.test(hash ?? "")
  ) {
    return { ok: false, reason: "Missing hash field" };
  }

  // 1. data-check-string
  const dataCheckString = Object.keys(rest)
    .filter(key => rest[key as keyof typeof rest] !== undefined)
    .sort()
    .map(k => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join("\n");

  // 2. secret_key = SHA256(bot_token)
  const secretKey = createHash("sha256").update(botToken).digest();

  // 3. computed hash
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // 4. constant-time compare
  if (
    computedHash.length !== hash.length ||
    !timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash))
  ) {
    return { ok: false, reason: "Invalid hash signature" };
  }

  // 5. freshness check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    nowSeconds - authData.auth_date > MAX_AUTH_AGE_SECONDS ||
    authData.auth_date > nowSeconds + 30
  ) {
    return { ok: false, reason: "Auth data expired" };
  }

  return { ok: true };
}

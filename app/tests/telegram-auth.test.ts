import { describe, it, expect, beforeEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  verifyTelegramAuth,
  type TelegramAuthData,
} from "../api/lib/telegram-auth";
import { resetDb } from "./helpers";

// Тестовый bot token (не настоящий — но для verifyTelegramAuth это не важно,
// функция использует переданный токен, а не env).
const TEST_BOT_TOKEN = "test-bot-token-1234567890";

/**
 * Генерирует корректный hash для TelegramAuthData, как это делает Telegram.
 */
function signAuthData(
  authData: Omit<TelegramAuthData, "hash">,
  botToken: string
): TelegramAuthData {
  const dataCheckString = Object.entries(authData)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  return { ...authData, hash };
}

describe("verifyTelegramAuth", () => {
  beforeEach(() => resetDb());

  it("accepts a properly signed auth payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const auth = signAuthData(
      {
        id: 123456789,
        first_name: "Test",
        username: "testuser",
        auth_date: now,
      },
      TEST_BOT_TOKEN
    );
    const result = verifyTelegramAuth(auth, TEST_BOT_TOKEN);
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered hash", () => {
    const now = Math.floor(Date.now() / 1000);
    const auth = signAuthData(
      { id: 123, first_name: "X", auth_date: now },
      TEST_BOT_TOKEN
    );
    // Меняем один байт в hash
    auth.hash = auth.hash.slice(0, -2) + "00";
    const result = verifyTelegramAuth(auth, TEST_BOT_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/Invalid hash/);
  });

  it("rejects when a field is added to payload but not to hash", () => {
    const now = Math.floor(Date.now() / 1000);
    const auth = signAuthData({ id: 123, auth_date: now }, TEST_BOT_TOKEN);
    // Добавляем поле после подписания — hash больше не валиден
    const tampered = { ...auth, username: "injected" };
    const result = verifyTelegramAuth(tampered, TEST_BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  it("rejects expired auth_date (> 1 hour old)", () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const auth = signAuthData(
      { id: 123, auth_date: twoHoursAgo },
      TEST_BOT_TOKEN
    );
    const result = verifyTelegramAuth(auth, TEST_BOT_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/expired/);
  });

  it("rejects when bot token is empty", () => {
    const now = Math.floor(Date.now() / 1000);
    const auth = signAuthData({ id: 123, auth_date: now }, TEST_BOT_TOKEN);
    const result = verifyTelegramAuth(auth, "");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("rejects when hash field is missing", () => {
    const now = Math.floor(Date.now() / 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noHash: any = {
      id: 123,
      auth_date: now,
    };
    const result = verifyTelegramAuth(noHash, TEST_BOT_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/hash/);
  });

  it("accepts auth_date at the boundary (just under 1 hour)", () => {
    const fiftyNineMinutesAgo = Math.floor(Date.now() / 1000) - 59 * 60;
    const auth = signAuthData(
      { id: 123, auth_date: fiftyNineMinutesAgo },
      TEST_BOT_TOKEN
    );
    const result = verifyTelegramAuth(auth, TEST_BOT_TOKEN);
    expect(result.ok).toBe(true);
  });
});

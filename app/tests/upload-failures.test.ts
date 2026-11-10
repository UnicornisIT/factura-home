/**
 * Отказные сценарии POST /api/upload: ошибка записи файла, сбой audit-журнала,
 * зависание обработки изображения и повреждённый файл. Проверяют, что сервер
 * всегда отвечает (не зависает) и не раскрывает технические детали.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import app, { __setSanitizeTimeoutForTests } from "../api/boot";
import { audit } from "../api/queries/security-store";
import { sanitizeImage } from "../api/lib/images";
import { resetDb } from "./helpers";
import { ensureOwner } from "../api/queries/admin-allowlist";
import { signSessionToken } from "../api/session";
import { Session } from "@contracts/constants";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
vi.mock("../api/queries/security-store", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../api/queries/security-store")>();
  return { ...actual, audit: vi.fn(actual.audit) };
});
vi.mock("../api/lib/images", async importOriginal => {
  const actual = await importOriginal<typeof import("../api/lib/images")>();
  return { ...actual, sanitizeImage: vi.fn(actual.sanitizeImage) };
});

const origin = "http://localhost:3000";
let cookie = "";

async function pngBytes(): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
}

function uploadRequest(bytes: Uint8Array, filename = "photo.png") {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes as BlobPart], filename, { type: "image/png" })
  );
  return app.request(origin + "/api/upload", {
    method: "POST",
    headers: { origin, cookie },
    body: form,
  });
}

beforeEach(async () => {
  // Сброс к оригинальным реализациям, заданным в vi.mock(...).
  vi.mocked(writeFile).mockReset();
  vi.mocked(audit).mockReset();
  vi.mocked(sanitizeImage).mockReset();
  resetDb();
  await ensureOwner();
  cookie = `${Session.cookieName}=${await signSessionToken({
    authMethod: "telegram",
    role: "super_admin",
    telegramId: 100,
  })}`;
});

describe("POST /api/upload failure modes", () => {
  it("responds 500 without hanging when the file write fails", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(writeFile).mockRejectedValueOnce(error);
    const response = await uploadRequest(await pngBytes());
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toMatch(/EACCES|\/var\/|\/opt\//);
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("returns the URL even when the audit log insert fails", async () => {
    vi.mocked(audit).mockRejectedValueOnce(new Error("database is locked"));
    const response = await uploadRequest(await pngBytes());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/[a-f0-9-]{36}\.webp$/);
  });

  it("responds 500 when image processing hangs instead of stalling forever", async () => {
    __setSanitizeTimeoutForTests(300);
    vi.mocked(sanitizeImage).mockImplementationOnce(
      () => new Promise<Buffer>(() => {})
    );
    try {
      const started = Date.now();
      const response = await uploadRequest(await pngBytes());
      expect(response.status).toBe(500);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      __setSanitizeTimeoutForTests(15_000);
    }
  });

  it("rejects a corrupted image with a 400 and a safe message", async () => {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const corrupted = Buffer.concat([pngSignature, Buffer.from("garbage")]);
    const response = await uploadRequest(corrupted);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Only valid JPEG, PNG and WebP images are allowed");
  });

  it("rejects files above 5 MB with 413", async () => {
    const oversize = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);
    const response = await uploadRequest(oversize, "big.png");
    expect(response.status).toBe(413);
  });
});

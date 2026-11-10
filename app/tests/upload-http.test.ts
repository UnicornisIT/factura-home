/**
 * Интеграционные тесты загрузки изображений через настоящий HTTP-стек
 * (@hono/node-server), а не через app.request(). Проверяют сценарии, которые
 * видны только на реальном соединении: content-length и chunked-тела,
 * поведение bodyLimit, тайм-ауты и доступность сохранённого файла.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { serve, type ServerType } from "@hono/node-server";
import app from "../api/boot";
import { resetDb } from "./helpers";
import { ensureOwner } from "../api/queries/admin-allowlist";
import { signSessionToken } from "../api/session";
import {
  createCollection,
  updateCollection,
  listCollections,
} from "../api/queries/collections";
import { Session } from "@contracts/constants";

const origin = "http://localhost:3000";

let server: ServerType;
let baseUrl = "";
let cookie = "";

async function issueOwnerCookie(): Promise<string> {
  // Сессия владельца выпускается напрямую (тот же путь, что telegram.verify).
  const token = await signSessionToken({
    authMethod: "telegram",
    role: "super_admin",
    telegramId: 100,
  });
  return `${Session.cookieName}=${token}`;
}

async function pngBytes(): Promise<Uint8Array> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

beforeAll(async () => {
  resetDb();
  await ensureOwner();
  cookie = await issueOwnerCookie();
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30000);

afterAll(() => {
  server?.close();
});

describe("POST /api/upload over real HTTP", () => {
  it("completes a multipart upload with Content-Length (nginx buffering on)", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([await pngBytes()], "photo.png", { type: "image/png" })
    );
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      }),
      15000,
      "multipart upload with content-length"
    );
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(/^\/uploads\/[a-f0-9-]{36}\.webp$/);
    const image = await fetch(`${baseUrl}${url}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
  }, 20000);

  it("completes a chunked multipart upload without Content-Length", async () => {
    const bytes = await pngBytes();
    const boundary = "----reproboundary";
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
      "utf8"
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const body = Buffer.concat([head, Buffer.from(bytes), tail]);
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        // @ts-expect-error — duplex требуется для stream-тела в undici
        duplex: "half",
        headers: {
          origin,
          cookie,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          // undici сам отправляет stream-тело через Transfer-Encoding: chunked
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        }),
      }),
      15000,
      "chunked multipart upload"
    );
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(/^\/uploads\/[a-f0-9-]{36}\.webp$/);
  }, 20000);

  it("responds 403 without leaking the body when Origin is invalid", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([await pngBytes()], "photo.png", { type: "image/png" })
    );
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { origin: "https://evil.example", cookie },
        body: form,
      }),
      15000,
      "upload with bad origin"
    );
    expect(response.status).toBe(403);
  }, 20000);

  it("responds 401 for an anonymous upload", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([await pngBytes()], "photo.png", { type: "image/png" })
    );
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { origin },
        body: form,
      }),
      15000,
      "anonymous upload"
    );
    expect(response.status).toBe(401);
  }, 20000);

  it("responds 413 when the body exceeds the limit", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024 + 1024, 1);
    const form = new FormData();
    form.append(
      "file",
      new File([big as unknown as BlobPart], "big.png", { type: "image/png" })
    );
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      }),
      30000,
      "oversized upload"
    );
    expect(response.status).toBe(413);
  }, 40000);

  it("persists the uploaded URL on a collection and keeps the file reachable", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([await pngBytes()], "photo.png", { type: "image/png" })
    );
    const response = await withTimeout(
      fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      }),
      15000,
      "upload for persistence check"
    );
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };

    const collection = await createCollection({
      slug: "upload-check",
      title: "Upload check",
    });
    await updateCollection(collection.id, { coverImage: url });
    const rows = await listCollections();
    expect(rows.find(row => row.id === collection.id)?.coverImage).toBe(url);

    // После 413-ответа сервер закрывает сокет с непрочитанным телом, и
    // undici может попытаться переиспользовать его из пула (ECONNRESET).
    // Один повтор исключает эту транспортную гонку из проверки.
    const image = await fetch(`${baseUrl}${url}`).catch(async () =>
      fetch(`${baseUrl}${url}`)
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
  }, 20000);
});

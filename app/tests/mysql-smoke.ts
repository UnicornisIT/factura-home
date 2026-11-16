import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ensureOwner,
  changeAccess,
  findActiveByTelegramId,
} from "../api/queries/admin-allowlist";
import { signSessionToken, verifySessionToken } from "../api/session";
import { createCollection } from "../api/queries/collections";
import { createProduct } from "../api/queries/products";
import { listOrders } from "../api/queries/orders";
import { ordersRouter } from "../api/orders-router";
import { securitySql } from "../api/queries/security-store";
import { env } from "../api/lib/env";
import { deliverNextOrderNotification } from "../api/lib/order-telegram";
async function smoke() {
  await ensureOwner();
  await changeAccess(100, 200, "add");
  const token = await signSessionToken({
    authMethod: "telegram",
    role: "admin",
    telegramId: 200,
  });
  assert.equal((await verifySessionToken(token))?.telegramId, 200);
  await changeAccess(100, 200, "deactivate");
  await changeAccess(100, 200, "add");
  assert.equal(await verifySessionToken(token), null);
  const collection = await createCollection({
    slug: randomUUID(),
    title: "Test",
  });
  const product = await createProduct({
    collectionId: collection.id,
    name: "Test",
    price: 700,
  });
  await securitySql(
    "INSERT INTO orderTelegramSubscriptions (telegramId, subscriptionKey) VALUES (?, ?), (?, ?)",
    [100, randomUUID(), 200, randomUUID()]
  );
  const checkout = ordersRouter.createCaller({
    req: new Request(env.publicOrigin),
    resHeaders: new Headers(),
  });
  const data = {
    name: "Test",
    contactDetails: {
      telegram: "@buyer",
      phone: "+1 (202) 555-0123",
      email: "buyer@example.com",
      preferred: "email" as const,
    },
    items: [{ productId: product.id, qty: 2 }],
    requestId: randomUUID(),
  };
  const [order, duplicate] = await Promise.all([
    checkout.create(data),
    checkout.create(data),
  ]);
  assert.deepEqual(duplicate, order);
  assert.equal(order.total, 1400);
  assert.equal(order.contact, "buyer@example.com");
  assert.deepEqual(
    (await listOrders()).find(entry => entry.id === order.id)?.contactDetails,
    {
      telegram: "buyer",
      phone: "+12025550123",
      email: "buyer@example.com",
      preferred: "email",
    }
  );
  const sentTo: number[] = [];
  const messages: string[] = [];
  assert.ok(
    env.telegramBotToken,
    "MySQL smoke requires a dummy Telegram token"
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    sentTo.push(body.chat_id);
    messages.push(body.text);
    return Response.json({ ok: true });
  };
  try {
    await Promise.all([
      deliverNextOrderNotification(),
      deliverNextOrderNotification(),
    ]);
    await deliverNextOrderNotification();
    assert.equal(await deliverNextOrderNotification(), false);
    assert.deepEqual(sentTo.sort(), [100, 200]);
    for (const message of messages) {
      assert.match(
        message,
        /Telegram: @buyer\nТелефон: \+1 202 555 0123\nEmail: buyer@example.com/
      );
      assert.match(message, /Предпочтительный способ: Email/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  await changeAccess(100, 300, "add", "super_admin");
  await changeAccess(100, 400, "add", "super_admin");
  await Promise.allSettled([
    changeAccess(300, 400, "deactivate"),
    changeAccess(400, 300, "deactivate"),
    changeAccess(300, 100, "role", "admin"),
  ]);
  assert.equal((await findActiveByTelegramId(100))?.role, "super_admin");
  assert.ok((await securitySql("SELECT id FROM adminAuditLog")).length > 0);
}
smoke()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(String(error));
    process.exit(1);
  });

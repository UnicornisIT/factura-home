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
import { createOrder, listOrders } from "../api/queries/orders";
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
  const order = await createOrder({
    name: "Test",
    contact: "test",
    items: [{ productId: product.id, qty: 2 }],
  });
  assert.equal(order.total, 1400);
  assert.ok((await listOrders()).some(entry => entry.id === order.id));
  const sentTo: number[] = [];
  assert.ok(
    env.telegramBotToken,
    "MySQL smoke requires a dummy Telegram token"
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentTo.push(JSON.parse(String(init?.body)).chat_id);
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

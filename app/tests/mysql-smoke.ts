import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnection } from "mysql2/promise";
import {
  ensureOwner,
  changeAccess,
  findActiveByTelegramId,
} from "../api/queries/admin-allowlist";
import { signSessionToken, verifySessionToken } from "../api/session";
import {
  createCollection,
  deleteCollection,
  listCollectionsWithProductCounts,
} from "../api/queries/collections";
import { createProduct, updateProduct } from "../api/queries/products";
import { listOrders } from "../api/queries/orders";
import { ordersRouter } from "../api/orders-router";
import { securitySql } from "../api/queries/security-store";
import { env } from "../api/lib/env";
import { consumeRateLimit } from "../api/lib/rate-limit";
import { deliverNextOrderNotification } from "../api/lib/order-telegram";
import { blocksRouter } from "../api/blocks-router";
import { blockDefaults } from "@contracts/blocks";
import { checkInitialAdmins } from "./bootstrap-admins-scenarios";

async function checkHomePublication() {
  const context = {
    req: new Request(env.publicOrigin),
    resHeaders: new Headers(),
  };
  const visitor = blocksRouter.createCaller(context);
  const admin = blocksRouter.createCaller({
    ...context,
    user: { authMethod: "telegram", telegramId: 100, role: "super_admin" },
  });
  await assert.rejects(visitor.draft.get(), { code: "UNAUTHORIZED" });
  const initial = await admin.draft.get();
  const before = await visitor.list();
  const first = {
    id: -1,
    type: "text" as const,
    isVisible: true,
    background: "#def",
    data: blockDefaults("text"),
  };
  const second = {
    id: -2,
    type: "cover" as const,
    isVisible: false,
    background: null,
    data: { ...blockDefaults("cover"), buttonLink: "#block--1" },
  };
  const saved = await admin.draft.save({
    version: initial.version,
    blocks: [first, second, ...initial.blocks],
  });
  assert.deepEqual(await visitor.list(), before);
  await assert.rejects(admin.draft.publish({ version: initial.version }), {
    code: "CONFLICT",
  });
  const connection = await createConnection(env.databaseUrl);
  try {
    await connection.query(
      "CREATE TRIGGER smoke_reject_publication BEFORE UPDATE ON blocks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'smoke publication failure'"
    );
    try {
      await assert.rejects(
        admin.draft.publish({ version: saved.version }),
        /smoke publication failure/
      );
    } finally {
      await connection.query("DROP TRIGGER smoke_reject_publication");
    }
  } finally {
    await connection.end();
  }
  assert.deepEqual(await visitor.list(), before);
  assert.deepEqual(await admin.draft.get(), saved);
  const published = await admin.draft.publish({ version: saved.version });
  const [text, cover, ...existing] = published.blocks;
  assert.ok(text.id > 0 && cover.id > 0);
  assert.equal(text.background, "#def");
  assert.equal(cover.isVisible, false);
  assert.equal(
    cover.type === "cover" && cover.data.buttonLink,
    `#block-${text.id}`
  );
  assert.deepEqual(
    existing.map(block => block.id),
    initial.blocks.map(block => block.id)
  );
  assert.deepEqual(await admin.draft.get(), published);
  assert.deepEqual(
    await visitor.list(),
    published.blocks.filter(block => block.isVisible)
  );
}
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
  const emptyCollection = await createCollection({
    slug: randomUUID(),
    title: "Empty",
  });
  await updateProduct(product.id, { isActive: false });
  const counts = await listCollectionsWithProductCounts();
  assert.equal(counts.find(row => row.id === collection.id)?.productCount, 1);
  assert.equal(
    counts.find(row => row.id === emptyCollection.id)?.productCount,
    0
  );
  await assert.rejects(deleteCollection(collection.id), { code: "CONFLICT" });
  await deleteCollection(emptyCollection.id);
  await assert.rejects(deleteCollection(emptyCollection.id), {
    code: "NOT_FOUND",
  });
  await updateProduct(product.id, { isActive: true });
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
  await checkHomePublication();
  await checkInitialAdmins();
  const bucket = "mysql-rate-smoke:" + randomUUID();
  const decisions = await Promise.all(
    Array.from({ length: 12 }, () => consumeRateLimit(bucket, 10, 60_000))
  );
  assert.equal(decisions.filter(Boolean).length, 10);
}
smoke()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(String(error));
    process.exit(1);
  });

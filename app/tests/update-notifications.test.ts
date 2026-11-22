import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appRouter } from "../api/router";
import { changeAccess } from "../api/queries/admin-allowlist";
import { __resetDbForTests } from "../api/queries/connection";
import { securitySql } from "../api/queries/security-store";
import {
  changeUpdateTelegramPreference,
  recordUpdateRequest,
} from "../api/queries/update-notifications";
import {
  checkForNewRelease,
  deliverNextUpdateNotification,
  reconcileUpdateJournal,
} from "../api/lib/update-notifications";
import {
  __resetReleaseCacheForTests,
  compareStableRelease,
} from "../api/lib/system-update";
import { releaseExcerpt } from "../api/lib/release-markdown";
import { addAllowlistEntry, resetDb } from "./helpers";

const testEnv = vi.hoisted(() => ({ sqlitePath: ":memory:" }));
vi.mock("../api/lib/env", async importOriginal => {
  const actual = await importOriginal<typeof import("../api/lib/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get sqlitePath() {
        return testEnv.sqlitePath;
      },
    },
  };
});

const send = vi.fn<typeof fetch>();
const events = () => securitySql("SELECT * FROM updateEvents ORDER BY id");
const deliveries = () =>
  securitySql("SELECT * FROM updateTelegramOutbox ORDER BY id");
const caller = (telegramId: number, role = "admin") =>
  appRouter.createCaller({
    req: new Request("http://localhost:3000"),
    resHeaders: new Headers(),
    user: { authMethod: "telegram", telegramId, role },
  });

const notes =
  "## Что нового\n\n1. **Обновлён** *каталог* и [фильтр](https://example.test/filter).\n2. Добавлена \x60команда\x60.";

function release(tag: string, publishedAt: number, body = notes) {
  __resetReleaseCacheForTests();
  send.mockResolvedValueOnce(
    Response.json({
      tag_name: tag,
      published_at: new Date(publishedAt).toISOString(),
      html_url: `https://github.com/UnicornisIT/factura-home/releases/tag/${tag}`,
      body,
    })
  );
}

beforeEach(async () => {
  resetDb();
  vi.stubGlobal("FACTURA_BUILD_VERSION", "1.9.0");
  vi.stubGlobal(
    "fetch",
    send.mockReset().mockImplementation(async () => Response.json({ ok: true }))
  );
  await addAllowlistEntry({ telegramId: 100, role: "super_admin" });
  await addAllowlistEntry({ telegramId: 200 });
});

afterEach(() => {
  __resetReleaseCacheForTests();
  vi.unstubAllGlobals();
});

it("records the first newer release for the inbox without sending historical Telegram messages", async () => {
  const now = Date.now();
  await changeUpdateTelegramPreference(200, true);
  release("v1.10.0", now - 600_000);
  expect(await checkForNewRelease(now)).toBe(true);
  expect(await deliveries()).toHaveLength(0);
  const inbox = await caller(200).updateNotifications.inbox({ page: 0 });
  expect(inbox.items[0]).toMatchObject({
    kind: "update_available",
    version: "v1.10.0",
  });
  expect(inbox.items[0].releaseSummary).toContain("Обновлён каталог и фильтр");
  expect(inbox.items[0].releaseSummary).not.toMatch(/##|\*\*|\]\(/);
});

it("deduplicates concurrent checks, restart and Telegram fan-out, with independent read state", async () => {
  const now = Date.now();
  release("v1.9.0", now - 60_000);
  await checkForNewRelease(now - 30_000);
  expect(await events()).toHaveLength(0);
  await changeUpdateTelegramPreference(200, true);
  await securitySql("INSERT INTO orderTelegramSubscriptions VALUES (?, ?)", [
    100,
    "orders-only",
  ]);
  release("v1.10.0", now - 1000);
  expect(await checkForNewRelease(now)).toBe(true);
  await Promise.all([checkForNewRelease(now + 1), checkForNewRelease(now + 2)]);
  release("v1.10.0", now - 1000);
  await checkForNewRelease(now + 3);
  const [event] = await events();
  expect(await events()).toHaveLength(1);
  expect(await deliveries()).toMatchObject([{ telegramId: 200 }]);
  const owner = caller(100, "super_admin").updateNotifications;
  const admin = caller(200).updateNotifications;
  await admin.markRead({ eventId: Number(event.id) });
  await admin.markRead({ eventId: Number(event.id) });
  expect(await admin.inbox({ page: 0 })).toMatchObject({
    unread: 0,
    items: [{ isRead: true }],
  });
  expect(await owner.inbox({ page: 0 })).toMatchObject({
    unread: 1,
    items: [{ isRead: false }],
  });
  await owner.markAllRead();
  expect(await owner.inbox({ page: 0 })).toMatchObject({ unread: 0 });
  await deliverNextUpdateNotification();
  expect(JSON.parse(String(send.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
    chat_id: 200,
    parse_mode: "HTML",
    text: expect.stringContaining("<b>Обновлён</b> <i>каталог</i>"),
    reply_markup: { inline_keyboard: [[{ text: "Посмотреть релиз" }]] },
  });
});

it("ignores current, older, invalid and prerelease tags and retries after GitHub errors", async () => {
  expect(compareStableRelease("v1.10.0", "1.10.0-rc.2")).toBe(1);
  expect(compareStableRelease("v1.10.0+metadata", "v1.10.0")).toBe(0);
  expect(compareStableRelease("v2.0.0", null)).toBeNull();
  for (const tag of ["v1.9.0", "v1.8.99", "v2.0.0-rc.2", "nightly"]) {
    release(tag, Date.now());
    expect(await checkForNewRelease()).toBe(false);
  }
  __resetReleaseCacheForTests();
  send.mockRejectedValueOnce(new Error("GitHub unavailable"));
  expect(await checkForNewRelease()).toBe(false);
  expect(await events()).toHaveLength(0);
  release("v1.10.0", Date.now());
  expect(await checkForNewRelease()).toBe(true);
});

it("persists panel and manual installations, waits for healthcheck and records rollback outcomes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "factura-update-journal-"));
  const path = join(dir, "status.json");
  const startedAt = new Date(Date.now() - 5000).toISOString();
  const finishedAt = new Date().toISOString();
  const write = async (
    operationId: string,
    fields: Record<string, unknown>
  ) => {
    const status = JSON.stringify({
      operationId,
      state: "running",
      tag: "v1.10.0",
      fromVersion: "v1.9.0",
      targetVersion: "v1.10.0",
      startedAt,
      updatedAt: startedAt,
      source: "manual",
      ...fields,
    });
    await writeFile(path + `.operation-${operationId}.json`, status);
    await writeFile(path, status);
  };
  try {
    const owner = caller(100, "super_admin");
    const admin = caller(200);
    await expect(admin.system.startUpdate()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.system.updateHistory({ page: 0 })).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await recordUpdateRequest("panel-run", 100);
    await write("panel-run", {
      source: "panel",
      stage: "проверка работоспособности",
    });
    await Promise.all([
      reconcileUpdateJournal(path),
      reconcileUpdateJournal(path),
    ]);
    expect((await events()).map(e => e.kind)).toEqual(["update_started"]);
    await write("panel-run", { source: "panel", state: "success", finishedAt });
    for (const [id, rollback] of [
      ["manual-restored", "restored"],
      ["manual-no-rollback", null],
      ["manual-failed", "failed"],
    ]) {
      await write(id!, {
        state: "failed",
        finishedAt,
        stage: "проверка работоспособности",
        rollback,
        message: "token=password /internals",
      });
    }
    await reconcileUpdateJournal(path);
    await reconcileUpdateJournal(path);
    const history = await owner.system.updateHistory({ page: 0 });
    expect(history.items).toHaveLength(4);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "panel-run",
          source: "panel",
          state: "success",
          initiatedBy: 100,
        }),
        expect.objectContaining({
          operationId: "manual-restored",
          source: "manual",
          state: "failed",
          rollback: "restored",
        }),
        expect.objectContaining({
          operationId: "manual-failed",
          source: "manual",
          state: "failed",
          rollback: "failed",
        }),
      ])
    );
    expect(JSON.stringify(history)).not.toMatch(/token=password|internals/);
    const inbox = await admin.updateNotifications.inbox({ page: 0 });
    expect(
      inbox.items.filter(item => item.kind === "update_started")
    ).toHaveLength(4);
    expect(
      inbox.items.filter(item => item.kind === "update_success")
    ).toHaveLength(1);
    expect(
      inbox.items.filter(item => item.kind === "update_failed")
    ).toHaveLength(3);
    expect(JSON.stringify(inbox)).not.toMatch(
      /panel-run|manual-failed|initiatedBy|diagnostic/
    );
    await reconcileUpdateJournal(path, Date.now() + 3 * 60 * 60_000);
    expect(await owner.system.updateHistory({ page: 0 })).toEqual(history);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("cancels queued work on disable and deactivation, including after re-subscription", async () => {
  const now = Date.now();
  release("v1.9.0", now - 1000);
  await checkForNewRelease(now - 5000);
  await changeUpdateTelegramPreference(100, true);
  await changeUpdateTelegramPreference(200, true);
  release("v1.10.0", now - 1000);
  await checkForNewRelease(now);
  await changeUpdateTelegramPreference(100, false);
  await changeUpdateTelegramPreference(100, true);
  await changeAccess(100, 200, "deactivate", "admin");
  expect(await deliveries()).toEqual([
    expect.objectContaining({ status: "cancelled" }),
    expect.objectContaining({ status: "cancelled" }),
  ]);
  expect(await deliverNextUpdateNotification()).toBe(false);
  expect(
    await caller(100, "super_admin").orderNotifications.settings()
  ).toMatchObject({ enabled: false });
});

it("recovers a stalled attempt and preserves history and read state when SQLite reopens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "factura-update-recovery-"));
  const path = join(dir, "status.json");
  try {
    testEnv.sqlitePath = join(dir, "db.sqlite");
    resetDb();
    await addAllowlistEntry({ telegramId: 100, role: "super_admin" });
    const owner = caller(100, "super_admin");
    const now = Date.now();
    const then = new Date(now - 3 * 60 * 60_000).toISOString();
    const running = {
      state: "running",
      operationId: "stalled",
      source: "manual",
      startedAt: then,
      updatedAt: then,
      targetVersion: "v1.10.0",
    };
    await writeFile(path, JSON.stringify(running));
    await reconcileUpdateJournal(path, now);
    expect((await owner.system.updateHistory({ page: 0 })).items[0].state).toBe(
      "unconfirmed"
    );
    expect((await events()).map(event => event.kind)).toEqual([
      "update_started",
    ]);
    await owner.updateNotifications.markAllRead();
    __resetDbForTests();
    expect(await owner.updateNotifications.inbox({ page: 0 })).toMatchObject({
      unread: 0,
      items: [{ isRead: true }],
    });
    await writeFile(
      path,
      JSON.stringify({
        ...running,
        state: "success",
        finishedAt: new Date(now).toISOString(),
      })
    );
    await reconcileUpdateJournal(path, now);
    expect((await owner.system.updateHistory({ page: 0 })).items[0].state).toBe(
      "success"
    );
    expect((await events()).map(event => event.kind)).toEqual([
      "update_started",
      "update_success",
    ]);
  } finally {
    __resetDbForTests();
    testEnv.sqlitePath = ":memory:";
    await rm(dir, { recursive: true, force: true });
  }
});

it("retries on Telegram rate limit and falls back to plain text if HTML is rejected", async () => {
  const now = Date.now();
  release("v1.9.0", now);
  await checkForNewRelease(now - 5000);
  await changeUpdateTelegramPreference(200, true);
  release("v1.10.0", now);
  await checkForNewRelease(now);
  send.mockResolvedValueOnce(
    Response.json(
      { ok: false, parameters: { retry_after: 120 } },
      { status: 429 }
    )
  );
  await deliverNextUpdateNotification();
  expect(await deliveries()).toMatchObject([
    { status: "pending", attempts: 1 },
  ]);
  expect(Number((await deliveries())[0].availableAt)).toBeGreaterThanOrEqual(
    now + 120_000
  );
  await securitySql("UPDATE updateTelegramOutbox SET availableAt = 0");
  send.mockResolvedValueOnce(Response.json({ ok: false }, { status: 400 }));
  await deliverNextUpdateNotification();
  const fallback = JSON.parse(String(send.mock.calls.at(-1)?.[1]?.body));
  expect(fallback.parse_mode).toBeUndefined();
  expect(fallback.text).toContain("Обновлён каталог и фильтр");
  expect(await deliveries()).toMatchObject([{ status: "sent", attempts: 2 }]);
});

it("converts GFM structurally, sanitizes links and truncates the rendered message", () => {
  const markdown =
    notes +
    "\n\n| A | B |\n| --- | --- |\n| C | D |\n\n> текст и <script>код</script>\n\n[link](javascript:alert%281%29) & <tag>\n\n" +
    "😀".repeat(3000);
  const html = releaseExcerpt(markdown, 1000, true);
  expect(html).toContain('<a href="https://example.test/filter">фильтр</a>');
  expect(html).toContain("<code>команда</code>");
  expect(html).toContain("C · D");
  expect(html).toContain("&amp;");
  expect(html).not.toMatch(/javascript:|<script>|<tag>|\*\*|##|\]\(/);
  expect(html).toMatch(/…$/);
  expect(
    html.replace(/<[^>]+>/g, "").replace("&amp;", "&").length
  ).toBeLessThanOrEqual(1000);
});

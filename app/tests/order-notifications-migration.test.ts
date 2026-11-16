import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("upgrades SQLite with existing orders and administrators without backfilling", () => {
  const directory = new URL("../db/migrations/", import.meta.url);
  const db = new Database(":memory:");
  const migration = "005_order_notifications.sqlite.sql";
  try {
    db.pragma("foreign_keys = ON");
    for (const file of readdirSync(directory).sort())
      if (file.endsWith(".sqlite.sql") && file < migration)
        db.exec(readFileSync(new URL(file, directory), "utf8"));

    db.exec(`
      INSERT INTO orders (name, contact, items, total) VALUES ('Buyer', 'contact', '[]', 700);
      INSERT INTO adminAllowlist (telegramId) VALUES (100);
    `);

    const upgrade = readFileSync(new URL(migration, directory), "utf8");
    db.exec(upgrade);
    db.exec(upgrade);
    expect(db.prepare("SELECT name, total FROM orders").get()).toEqual({
      name: "Buyer",
      total: 700,
    });
    expect(db.prepare("SELECT telegramId FROM adminAllowlist").get()).toEqual({
      telegramId: 100,
    });
    expect(
      db.prepare("SELECT * FROM orderTelegramSubscriptions").all()
    ).toEqual([]);
    expect(db.prepare("SELECT * FROM orderTelegramOutbox").all()).toEqual([]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});

it("adds structured contacts and a unique request key without changing existing orders", () => {
  const directory = new URL("../db/migrations/", import.meta.url);
  const db = new Database(":memory:");
  const migration = "006_order_contacts.sqlite.sql";
  try {
    for (const file of readdirSync(directory).sort())
      if (file.endsWith(".sqlite.sql") && file < migration)
        db.exec(readFileSync(new URL(file, directory), "utf8"));
    db.exec(
      "INSERT INTO orders (name, contact, items, total) VALUES ('Buyer', '@buyer', '[]', 700)"
    );
    db.exec(readFileSync(new URL(migration, directory), "utf8"));
    expect(
      db.prepare("SELECT contact, contactDetails, requestKey FROM orders").get()
    ).toEqual({ contact: "@buyer", contactDetails: null, requestKey: null });
    const insert = db.prepare(
      "INSERT INTO orders (name, contact, items, total, contactDetails, requestKey) VALUES ('Buyer', '@buyer', '[]', 700, ?, ?)"
    );
    const details = JSON.stringify({
      telegram: "buyer",
      preferred: "telegram",
    });
    insert.run(details, "request-key");
    expect(() => insert.run(details, "request-key")).toThrow(/UNIQUE/);
  } finally {
    db.close();
  }
});

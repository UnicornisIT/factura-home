import "dotenv/config";
import { getDb, __getSqliteClient } from "../api/queries/connection";
import { collections, products, siteContent } from "./schema";
import type { Collection } from "./schema";
import { ensureOwner } from "../api/queries/admin-allowlist";
import { ensureDefaultBlocks } from "../api/queries/blocks";
import { env } from "../api/lib/env";
import { DDL } from "./sqlite-ddl";

// Seed может запускаться и на свежей базе, и на уже мигрированной,
// поэтому ALTER-утверждения с существующим столбцом пропускаются.
function ensureSchema() {
  if (env.dbDialect !== "sqlite") return;
  const client = __getSqliteClient();
  for (const statement of DDL.split(";")
    .map(value => value.trim())
    .filter(Boolean)) {
    try {
      client.exec(statement);
    } catch (error) {
      if (!String(error).includes("duplicate column name")) throw error;
    }
  }
}

async function seed() {
  await ensureSchema();
  const db = getDb();

  await ensureOwner();

  const existingCollections = await db.select().from(collections).limit(1);
  if (existingCollections.length === 0) {
    await db.insert(collections).values([
      {
        slug: "winter",
        title: "Зимняя коллекция",
        coverImage: "/img/cover-winter.png",
        sortOrder: 1,
      },
      {
        slug: "autumn",
        title: "Осенняя коллекция",
        coverImage: "/img/cover-autumn.png",
        sortOrder: 2,
      },
    ]);

    const cols = await db.select().from(collections);
    const winter = cols.find((c: Collection) => c.slug === "winter")!;
    const autumn = cols.find((c: Collection) => c.slug === "autumn")!;

    await db.insert(products).values([
      {
        collectionId: winter.id,
        name: "Тыква с листом",
        material: "Глина, молочный обжиг",
        price: 650,
        image: "/img/p1.png",
        sortOrder: 1,
      },
      {
        collectionId: winter.id,
        name: "Тыквы мини · набор из трёх",
        material: "Глина, матовая глазурь",
        price: 850,
        image: "/img/p4.png",
        sortOrder: 2,
      },
      {
        collectionId: winter.id,
        name: "Тыква с росписью",
        material: "Глина, ручная роспись",
        price: 750,
        image: "/img/p6.png",
        sortOrder: 3,
      },
      {
        collectionId: autumn.id,
        name: "Тыква терракотовая",
        material: "Терракота, без глазури",
        price: 650,
        image: "/img/p2.png",
        sortOrder: 1,
      },
      {
        collectionId: autumn.id,
        name: "Подсвечник-тыква",
        material: "Глина, ажурная резьба",
        price: 890,
        image: "/img/p3.png",
        sortOrder: 2,
      },
      {
        collectionId: autumn.id,
        name: "Ваза-тыква с сухоцветами",
        material: "Глина, охра; букет в подарок",
        price: 1200,
        image: "/img/p5.png",
        sortOrder: 3,
      },
    ]);

    await db.insert(siteContent).values({
      heroText:
        "Глиняные тыквы, подсвечники и вазы, которые делают дом теплее. Каждая вещь сделана вручную в нашей мастерской — от комка глины до последнего обжига.",
      aboutText:
        "Всё началось с одной тыквы, слепленной на кухне пять лет назад. Сегодня наша мастерская — это небольшая команда, гончарный круг, печь для обжига и полки, полные глины.\n\nМы работаем без форм и тиражей: две одинаковые вещи у нас не получатся, даже если очень постараться. В каждом изделии — отпечатки пальцев, следы инструмента и характер глины.\n\nИспользуем только локальную глину и безопасные глазури без свинца — посуду и подсвечники можно использовать каждый день.",
      aboutImage: "/img/workshop.png",
      deliveryText:
        "Каждую вещь заворачиваем в три слоя крафта и стружки — глина путешествует безопасно. Отправляем СДЭК или Почтой России в течение 2–3 дней после заказа. Доставка от 300 ₽, при заказе от 3 000 ₽ — бесплатно.",
      telegram: "https://t.me/",
      whatsapp: "https://wa.me/",
      email: "hello@factura.shop",
    });
  }

  // На свежей базе миграция 002 не находит siteContent и не создаёт блоки —
  // стартовый набор конструктора добавляется здесь из seeded-текстов.
  await ensureDefaultBlocks();

  process.exit(0);
}

seed().catch(e => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});

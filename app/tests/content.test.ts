import { describe, it, expect, beforeEach } from "vitest";
import { getSiteContent, updateSiteContent } from "../api/queries/content";
import { resetDb, seedSiteContent } from "./helpers";

describe("content queries (SQLite)", () => {
  beforeEach(() => resetDb());

  it("throws when siteContent is not seeded", async () => {
    await expect(getSiteContent()).rejects.toThrow(/not seeded/);
  });

  it("returns the seeded row", async () => {
    await seedSiteContent();
    const c = await getSiteContent();
    expect(c.shopName).toBe("Глиняная мастерская");
    expect(c.heroText).toBe("test hero text");
  });

  it("updates fields without touching others", async () => {
    await seedSiteContent();
    await updateSiteContent({
      shopName: "Новое название",
      telegram: "https://t.me/test",
    });
    const c = await getSiteContent();
    expect(c.shopName).toBe("Новое название");
    expect(c.telegram).toBe("https://t.me/test");
    // Не тронутые поля должны остаться прежними
    expect(c.heroText).toBe("test hero text");
    expect(c.email).toBe("");
  });

  it("returns updated content from updateSiteContent", async () => {
    await seedSiteContent();
    const updated = await updateSiteContent({ aboutTitle: "Наша история" });
    expect(updated.aboutTitle).toBe("Наша история");
  });
});

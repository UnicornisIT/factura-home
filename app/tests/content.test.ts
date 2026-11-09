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

  it("returns design defaults and parsed navItems on a fresh row", async () => {
    await seedSiteContent();
    const c = await getSiteContent();
    expect(c.navItems).toEqual([]);
    expect(c.design.colors.accent).toBe("#831C25");
    expect(c.design.fonts.heading).toBe("cormorant");
    expect(c.showShopName).toBe(true);
    expect(c.vk).toBe("");
  });

  it("round-trips navItems and design settings", async () => {
    await seedSiteContent();
    const design = (await getSiteContent()).design;
    await updateSiteContent({
      navItems: [
        { label: "Каталог", anchor: "#catalog", visible: true },
        { label: "Доставка", anchor: "#delivery", visible: false },
      ],
      design: { ...design, radius: 8, density: "airy" },
      vk: "https://vk.com/club1",
      footerText: "ИП Иванова",
      logoImage: "/uploads/logo.webp",
      showShopName: false,
    });
    const c = await getSiteContent();
    expect(c.navItems).toEqual([
      { label: "Каталог", anchor: "#catalog", visible: true },
      { label: "Доставка", anchor: "#delivery", visible: false },
    ]);
    expect(c.design.radius).toBe(8);
    expect(c.design.density).toBe("airy");
    expect(c.vk).toBe("https://vk.com/club1");
    expect(c.footerText).toBe("ИП Иванова");
    expect(c.logoImage).toBe("/uploads/logo.webp");
    expect(c.showShopName).toBe(false);
  });

  it("replaces corrupted navJson and designJson with defaults", async () => {
    await seedSiteContent();
    await updateSiteContent({
      navItems: [{ label: "Каталог", anchor: "#catalog", visible: true }],
    });
    const { getDb } = await import("../api/queries/connection");
    const { siteContent } = await import("@db/schema");
    await getDb().update(siteContent).set({
      navJson: "{не json",
      designJson: "[1,2,3]",
    });
    const c = await getSiteContent();
    expect(c.navItems).toEqual([]);
    expect(c.design.colors.background).toBe("#F8F0E8");
  });
});

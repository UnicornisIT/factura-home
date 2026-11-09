import { eq } from "drizzle-orm";
import { getDb } from "./connection";
import { siteContent } from "@db/schema";
import type { SiteContent } from "@db/schema";
import { normalizeDesign, normalizeNavItems } from "@contracts/design";

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * API-форма содержимого сайта: вместо сырых JSON-колонок navJson/designJson
 * отдаёт разобранные navItems и design с подстановкой значений по умолчанию.
 */
function toApiContent(row: SiteContent) {
  const { navJson, designJson, ...rest } = row;
  return {
    ...rest,
    navItems: normalizeNavItems(safeParse(navJson)),
    design: normalizeDesign(safeParse(designJson)),
  };
}

export type ApiSiteContent = ReturnType<typeof toApiContent>;

export async function getSiteContent(): Promise<ApiSiteContent> {
  const rows = await getDb().select().from(siteContent).limit(1);
  if (!rows[0]) throw new Error("Site content not seeded");
  return toApiContent(rows[0]);
}

export type SiteContentUpdate = Partial<
  Omit<SiteContent, "id" | "updatedAt" | "navJson" | "designJson">
> & {
  navItems?: ReturnType<typeof normalizeNavItems>;
  design?: ReturnType<typeof normalizeDesign>;
};

export async function updateSiteContent(
  data: SiteContentUpdate
): Promise<ApiSiteContent> {
  const { navItems, design, ...rest } = data;
  const current = await getDb().select().from(siteContent).limit(1);
  if (!current[0]) throw new Error("Site content not seeded");
  const update: Partial<Omit<SiteContent, "id" | "updatedAt">> = { ...rest };
  if (navItems !== undefined) update.navJson = JSON.stringify(navItems);
  if (design !== undefined) update.designJson = JSON.stringify(design);
  await getDb()
    .update(siteContent)
    .set(update)
    .where(eq(siteContent.id, current[0].id));
  return getSiteContent();
}

import { eq } from "drizzle-orm";
import { getDb } from "./connection";
import { siteContent } from "@db/schema";
import type { SiteContent } from "@db/schema";

export async function getSiteContent(): Promise<SiteContent> {
  const rows = await getDb().select().from(siteContent).limit(1);
  if (!rows[0]) throw new Error("Site content not seeded");
  return rows[0];
}

export async function updateSiteContent(
  data: Partial<Omit<SiteContent, "id" | "updatedAt">>
): Promise<SiteContent> {
  const current = await getSiteContent();
  await getDb()
    .update(siteContent)
    .set(data)
    .where(eq(siteContent.id, current.id));
  return getSiteContent();
}

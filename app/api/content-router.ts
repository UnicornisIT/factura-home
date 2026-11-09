import { imageUrl, contactUrl } from "./lib/validation";
import { designSettingsSchema, navItemsSchema } from "./lib/design-schema";
import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { getSiteContent, updateSiteContent } from "./queries/content";

export const contentRouter = createRouter({
  get: publicQuery.query(() => getSiteContent()),

  update: adminQuery
    .input(
      z.object({
        shopName: z.string().min(1).max(255).optional(),
        heroTitle: z.string().min(1).max(500).optional(),
        heroText: z.string().min(1).optional(),
        aboutTitle: z.string().min(1).max(255).optional(),
        aboutText: z.string().min(1).optional(),
        aboutImage: imageUrl.nullable().optional(),
        deliveryTitle: z.string().min(1).max(255).optional(),
        deliveryText: z.string().min(1).optional(),
        footerCta: z.string().min(1).max(500).optional(),
        footerText: z.string().max(500).optional(),
        telegram: contactUrl.optional(),
        whatsapp: contactUrl.optional(),
        vk: contactUrl.optional(),
        email: z.union([z.literal(""), z.email().max(320)]).optional(),
        logoImage: imageUrl.optional(),
        showShopName: z.boolean().optional(),
        navItems: navItemsSchema.optional(),
        design: designSettingsSchema.optional(),
      })
    )
    .mutation(({ input }) => updateSiteContent(input)),
});

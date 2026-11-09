import { z } from "zod";
import { FONT_KEYS, MAX_NAV_ITEMS } from "@contracts/design";

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a HEX color like #831c25");

const fontKey = z.enum(FONT_KEYS);

export const designSettingsSchema = z.object({
  colors: z.object({
    background: hexColor,
    surface: hexColor,
    text: hexColor,
    textSoft: hexColor,
    accent: hexColor,
    accentDark: hexColor,
    olive: hexColor,
    beige: hexColor,
    card: hexColor,
    cardText: hexColor,
    button: hexColor,
    buttonText: hexColor,
    link: hexColor,
    header: hexColor,
    headerText: hexColor,
    footer: hexColor,
    footerText: hexColor,
  }),
  fonts: z.object({ heading: fontKey, body: fontKey }),
  radius: z.number().int().min(0).max(40),
  density: z.enum(["compact", "normal", "airy"]),
  headerSticky: z.boolean(),
  decorLeaves: z.boolean(),
  archPhotos: z.boolean(),
});

/** Пункт меню шапки: метка и якорь секции лендинга. */
export const navItemSchema = z.object({
  label: z.string().min(1).max(40),
  anchor: z
    .string()
    .regex(/^#[A-Za-z0-9_-]{1,64}$/, "Use a section anchor like #catalog"),
  visible: z.boolean(),
});

export const navItemsSchema = z.array(navItemSchema).max(MAX_NAV_ITEMS);

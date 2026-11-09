import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { imageUrl, httpsUrl } from "./validation";
import {
  BLOCK_TYPES,
  ICON_KEYS,
  MAX_DATA_JSON_LENGTH,
  blockDefaults,
  type BlockType,
  type BlockDataMap,
} from "@contracts/blocks";

const align = z.enum(["left", "center"]);
const columns = z.union([z.literal(2), z.literal(3), z.literal(4)]);
const iconKey = z.enum(ICON_KEYS);
const iconFeature = z.object({
  icon: iconKey,
  title: z.string().max(120),
});

/** Якорь (#…), относительный путь (/…) или HTTPS-ссылка. */
const safeLink = z
  .string()
  .max(2048)
  .refine(
    value =>
      value === "" ||
      value.startsWith("#") ||
      (value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\")) ||
      httpsUrl(value),
    "Use an anchor, a local path or an HTTPS URL"
  );

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com"];
const videoUrl = z
  .string()
  .max(2048)
  .refine(value => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return false;
      const host = url.hostname.replace(/^www\./, "");
      return VIDEO_HOSTS.includes(host);
    } catch {
      return false;
    }
  }, "Use an HTTPS YouTube or Vimeo link");

export const blockDataSchemas = {
  cover: z.object({
    title: z.string().max(500),
    text: z.string().max(4000),
    buttonText: z.string().max(100),
    buttonLink: safeLink,
    backgroundImage: imageUrl,
    align,
    eyebrow: z.string().max(200).optional(),
    image: imageUrl.optional(),
    imagePosition: z.enum(["left", "right"]).optional(),
    features: z.array(iconFeature).max(4).optional(),
  }),
  text: z.object({
    title: z.string().max(255),
    text: z.string().max(20000),
    align,
    narrow: z.boolean(),
  }),
  features: z.object({
    title: z.string().max(255),
    items: z
      .array(
        z.object({ title: z.string().max(120), text: z.string().max(600) })
      )
      .min(1)
      .max(6),
    columns,
  }),
  gallery: z.object({
    title: z.string().max(255),
    images: z
      .array(z.object({ src: imageUrl, caption: z.string().max(200) }))
      .max(24),
    columns,
  }),
  image: z.object({
    src: imageUrl,
    caption: z.string().max(300),
    width: z.enum(["small", "medium", "large", "full"]),
  }),
  video: z.object({
    title: z.string().max(255),
    url: videoUrl,
  }),
  faq: z.object({
    title: z.string().max(255),
    items: z
      .array(
        z.object({
          question: z.string().min(1).max(300),
          answer: z.string().max(4000),
        })
      )
      .min(1)
      .max(30),
  }),
  steps: z.object({
    title: z.string().max(255),
    items: z
      .array(
        z.object({ title: z.string().max(120), text: z.string().max(600) })
      )
      .min(1)
      .max(10),
  }),
  about: z.object({
    title: z.string().max(255),
    text: z.string().max(20000),
    image: imageUrl,
    caption: z.string().max(200).optional(),
    quote: z.string().max(600).optional(),
    features: z
      .array(
        z.object({ title: z.string().max(120), text: z.string().max(600) })
      )
      .max(6)
      .optional(),
  }),
  catalog: z.object({
    title: z.string().max(255),
    text: z.string().max(2000).optional(),
    columns: columns.optional(),
  }),
  products: z.object({ title: z.string().max(255).optional() }),
  delivery: z.object({
    title: z.string().max(255),
    text: z.string().max(8000),
    image: imageUrl.optional(),
    cards: z
      .array(iconFeature.extend({ text: z.string().max(600) }))
      .max(6)
      .optional(),
  }),
  contacts: z.object({
    title: z.string().max(255).optional(),
    text: z.string().max(4000).optional(),
    image: imageUrl.optional(),
  }),
} satisfies Record<BlockType, z.ZodType>;

export const blockTypeSchema = z.enum(BLOCK_TYPES);

/** HEX-цвет фона блока: #rgb или #rrggbb. */
export const backgroundColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a HEX color like #5c2a2a");

/**
 * Валидирует данные блока по его типу и возвращает их.
 * Отклоняет слишком большой JSON, чтобы TEXT-колонка не переполнялась.
 */
export function validateBlockData<T extends BlockType>(
  type: T,
  data: unknown
): BlockDataMap[T] {
  const serialized = JSON.stringify(data ?? {});
  if (serialized.length > MAX_DATA_JSON_LENGTH)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Слишком большой объём данных блока",
    });
  return blockDataSchemas[type].parse(data) as BlockDataMap[T];
}

/**
 * Разбирает сохранённый JSON блока для отдачи клиенту.
 * Повреждённые данные заменяются значениями по умолчанию,
 * чтобы витрина не падала из-за одной испорченной строки.
 */
export function parseStoredBlockData<T extends BlockType>(
  type: T,
  raw: string
): BlockDataMap[T] {
  try {
    return blockDataSchemas[type].parse(JSON.parse(raw)) as BlockDataMap[T];
  } catch {
    return blockDefaults(type);
  }
}

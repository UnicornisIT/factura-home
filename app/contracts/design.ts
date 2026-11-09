/**
 * Контракт настроек дизайна сайта (дизайн-токены) и навигации.
 * Используется сервером (валидация, хранение в siteContent.designJson/navJson),
 * витриной (CSS-переменные, шапка) и админ-панелью (раздел «Дизайн сайта»).
 * Файл не должен импортировать zod и другие серверные зависимости.
 */

export type DesignColors = {
  background: string;
  surface: string;
  text: string;
  textSoft: string;
  accent: string;
  accentDark: string;
  olive: string;
  beige: string;
  card: string;
  cardText: string;
  button: string;
  buttonText: string;
  link: string;
  header: string;
  headerText: string;
  footer: string;
  footerText: string;
};

/** Безопасный набор шрифтов: только подключённые к витрине семейства. */
export const FONT_OPTIONS = [
  { key: "cormorant", label: "Cormorant (засечки)" },
  { key: "playfair", label: "Playfair Display (засечки)" },
  { key: "marck", label: "Marck Script (рукописный)" },
  { key: "inter", label: "Inter (без засечек)" },
  { key: "manrope", label: "Manrope (без засечек)" },
  { key: "system", label: "Системный" },
] as const;

export type FontKey = (typeof FONT_OPTIONS)[number]["key"];

/** Тот же набор ключей const-кортежем — для z.enum без расширения типа. */
export const FONT_KEYS = [
  "cormorant",
  "playfair",
  "marck",
  "inter",
  "manrope",
  "system",
] as const satisfies readonly FontKey[];

const FONT_STACKS: Record<FontKey, string> = {
  cormorant: "'Cormorant', Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  marck: "'Marck Script', cursive",
  inter: "'Inter', -apple-system, sans-serif",
  manrope: "'Manrope', -apple-system, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export function fontStack(key: FontKey): string {
  return FONT_STACKS[key] ?? FONT_STACKS.system;
}

export type DesignDensity = "compact" | "normal" | "airy";

export type DesignSettings = {
  colors: DesignColors;
  fonts: { heading: FontKey; body: FontKey };
  /** Базовое скругление карточек и кнопок, px (0–40). */
  radius: number;
  density: DesignDensity;
  headerSticky: boolean;
  /** Декоративные ветви/тени листвы поверх фотографий. */
  decorLeaves: boolean;
  /** Арочные и асимметричные края фотографий. */
  archPhotos: boolean;
};

export const DEFAULT_DESIGN: DesignSettings = {
  colors: {
    background: "#F8F0E8",
    surface: "#F3E3D2",
    text: "#40351F",
    textSoft: "#6F6248",
    accent: "#831C25",
    accentDark: "#68151D",
    olive: "#59612F",
    beige: "#D3B69C",
    card: "#FFFDF9",
    cardText: "#40351F",
    button: "#831C25",
    buttonText: "#F8F0E8",
    link: "#831C25",
    header: "#F8F0E8",
    headerText: "#40351F",
    footer: "#40351F",
    footerText: "#F3E3D2",
  },
  fonts: { heading: "cormorant", body: "inter" },
  radius: 20,
  density: "normal",
  headerSticky: true,
  decorLeaves: true,
  archPhotos: true,
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_KEY_SET = new Set<string>(FONT_KEYS);
const DENSITY_KEYS = new Set<string>(["compact", "normal", "airy"]);

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_RE.test(value) ? value : fallback;
}

/**
 * Приводит произвольные сохранённые данные к полным DesignSettings:
 * недостающие и некорректные поля заменяются значениями по умолчанию.
 * Гарантирует, что витрина не получит мусор вместо токенов.
 */
export function normalizeDesign(value: unknown): DesignSettings {
  const base = DEFAULT_DESIGN;
  if (typeof value !== "object" || value === null) return structuredClone(base);
  const raw = value as Record<string, unknown>;
  const rawColors =
    typeof raw.colors === "object" && raw.colors !== null
      ? (raw.colors as Record<string, unknown>)
      : {};
  const colors = {} as DesignColors;
  for (const key of Object.keys(base.colors) as (keyof DesignColors)[])
    colors[key] = hexOr(rawColors[key], base.colors[key]);
  const rawFonts =
    typeof raw.fonts === "object" && raw.fonts !== null
      ? (raw.fonts as Record<string, unknown>)
      : {};
  const heading = FONT_KEY_SET.has(String(rawFonts.heading))
    ? (String(rawFonts.heading) as FontKey)
    : base.fonts.heading;
  const body = FONT_KEY_SET.has(String(rawFonts.body))
    ? (String(rawFonts.body) as FontKey)
    : base.fonts.body;
  const radius =
    typeof raw.radius === "number" &&
    Number.isFinite(raw.radius) &&
    raw.radius >= 0 &&
    raw.radius <= 40
      ? Math.round(raw.radius)
      : base.radius;
  const density = DENSITY_KEYS.has(String(raw.density))
    ? (String(raw.density) as DesignDensity)
    : base.density;
  return {
    colors,
    fonts: { heading, body },
    radius,
    density,
    headerSticky:
      typeof raw.headerSticky === "boolean" ? raw.headerSticky : true,
    decorLeaves: typeof raw.decorLeaves === "boolean" ? raw.decorLeaves : true,
    archPhotos: typeof raw.archPhotos === "boolean" ? raw.archPhotos : true,
  };
}

const SECTION_PADDING: Record<DesignDensity, string> = {
  compact: "56px",
  normal: "84px",
  airy: "116px",
};

/**
 * Преобразует настройки дизайна в CSS-переменные для витрины.
 * Переменные применяются к корневому контейнеру страницы.
 */
export function designCssVars(design: DesignSettings): Record<string, string> {
  const { colors } = design;
  return {
    "--bg": colors.background,
    "--surface": colors.surface,
    "--text": colors.text,
    "--text-soft": colors.textSoft,
    "--accent": colors.accent,
    "--accent-dark": colors.accentDark,
    "--olive": colors.olive,
    "--beige": colors.beige,
    "--card": colors.card,
    "--card-fg": colors.cardText,
    "--btn-bg": colors.button,
    "--btn-fg": colors.buttonText,
    "--link": colors.link,
    "--header-bg": colors.header,
    "--header-fg": colors.headerText,
    "--footer-bg": colors.footer,
    "--footer-fg": colors.footerText,
    "--font-heading": fontStack(design.fonts.heading),
    "--font-body": fontStack(design.fonts.body),
    "--radius": `${design.radius}px`,
    "--section-pad": SECTION_PADDING[design.density],
  };
}

/** Пункт меню шапки: ссылка ведёт на якорь секции лендинга. */
export type NavItem = {
  label: string;
  anchor: string;
  visible: boolean;
};

const NAV_ANCHOR_RE = /^#[A-Za-z0-9_-]{1,64}$/;

export const MAX_NAV_ITEMS = 8;

/**
 * Разбирает сохранённый JSON пунктов меню. Пустой/повреждённый список
 * означает «меню формируется автоматически из блоков страницы».
 */
export function normalizeNavItems(value: unknown): NavItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_NAV_ITEMS)
    .filter((item): item is Record<string, unknown> => {
      if (typeof item !== "object" || item === null) return false;
      return (
        typeof item.label === "string" &&
        item.label.trim() !== "" &&
        typeof item.anchor === "string" &&
        NAV_ANCHOR_RE.test(item.anchor)
      );
    })
    .map(item => ({
      label: String(item.label).slice(0, 40),
      anchor: String(item.anchor),
      visible: item.visible !== false,
    }));
}

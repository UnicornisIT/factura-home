/**
 * Общий контракт блоков конструктора главной страницы.
 * Используется сервером (валидация, хранение), витриной (рендер)
 * и админ-панелью (формы редактирования, библиотека блоков).
 * Файл не должен импортировать zod и другие серверные зависимости.
 */

export const BLOCK_TYPES = [
  "cover",
  "text",
  "features",
  "gallery",
  "image",
  "video",
  "faq",
  "steps",
  "about",
  "catalog",
  "products",
  "delivery",
  "contacts",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** Блоки, которые рендерят данные из других таблиц и не дублируются. */
export const SINGLETON_BLOCK_TYPES: BlockType[] = [
  "catalog",
  "products",
  "contacts",
];

/**
 * Безопасный набор иконок для преимуществ и информационных карточек.
 * Витрина рисует их встроенным SVG, админка — через lucide-react.
 */
export const ICON_KEYS = [
  "leaf",
  "gift",
  "truck",
  "clock",
  "hand",
  "heart",
  "star",
  "shield",
  "box",
  "card",
  "flame",
  "sparkle",
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

export const ICON_LABELS: Record<IconKey, string> = {
  leaf: "Лист",
  gift: "Подарок",
  truck: "Доставка",
  clock: "Время",
  hand: "Рука",
  heart: "Сердце",
  star: "Звезда",
  shield: "Щит",
  box: "Упаковка",
  card: "Карта",
  flame: "Пламя",
  sparkle: "Блеск",
};

export const MAX_BLOCKS = 60;
export const MAX_DATA_JSON_LENGTH = 60_000;

export type IconFeature = { icon: IconKey; title: string };

export type CoverData = {
  title: string;
  text: string;
  buttonText: string;
  /** Якорь (#…), относительный путь (/…) или HTTPS-ссылка. */
  buttonLink: string;
  backgroundImage: string;
  align: "left" | "center";
  /** Необязательные поля расширения (старые сохранённые блоки их не имеют). */
  eyebrow?: string;
  /**
   * Композиция главного экрана: «split» — текст слева и фото в арке справа,
   * «center» — прежняя центрированная обложка. Без значения выводятся
   * по наличию главного фото.
   */
  layout?: "split" | "center";
  /** Главное фото в арочной форме; без него в арке декоративная заглушка. */
  image?: string;
  imagePosition?: "left" | "right";
  /** Точка фокуса кадрирования главного фото (object-position). */
  imageFocus?: "top" | "center" | "bottom";
  features?: IconFeature[];
};

export type TextData = {
  title: string;
  text: string;
  align: "left" | "center";
  narrow: boolean;
};

export type FeatureItem = { title: string; text: string };

export type FeaturesData = {
  title: string;
  items: FeatureItem[];
  columns: 2 | 3 | 4;
};

export type GalleryImage = { src: string; caption: string };

export type GalleryData = {
  title: string;
  images: GalleryImage[];
  columns: 2 | 3 | 4;
};

export type ImageData = {
  src: string;
  caption: string;
  width: "small" | "medium" | "large" | "full";
};

export type VideoData = {
  title: string;
  /** Ссылка YouTube или Vimeo; embed-URL строится на клиенте. */
  url: string;
};

export type FaqItem = { question: string; answer: string };

export type FaqData = {
  title: string;
  items: FaqItem[];
};

export type StepItem = { title: string; text: string };

export type StepsData = {
  title: string;
  items: StepItem[];
};

export type AboutData = {
  title: string;
  text: string;
  image: string;
  /** Подпись к фотографии процесса. */
  caption?: string;
  /** Декоративная цитата под текстом. */
  quote?: string;
  features?: FeatureItem[];
};

export type CatalogData = {
  title: string;
  /** Короткое описание под заголовком. */
  text?: string;
  columns?: 2 | 3 | 4;
};

export type DeliveryData = {
  title: string;
  text: string;
  /** Фотография упаковки/процесса отправки. */
  image?: string;
  /** Информационные карточки: упаковка, доставка, оплата, сроки. */
  cards?: (IconFeature & { text: string })[];
};

export type ContactsData = {
  title?: string;
  text?: string;
  image?: string;
};

export type ProductsData = {
  /** Заголовок секции; при активном фильтре заменяется названием категории. */
  title?: string;
};

export type BlockDataMap = {
  cover: CoverData;
  text: TextData;
  features: FeaturesData;
  gallery: GalleryData;
  image: ImageData;
  video: VideoData;
  faq: FaqData;
  steps: StepsData;
  about: AboutData;
  catalog: CatalogData;
  products: ProductsData;
  delivery: DeliveryData;
  contacts: ContactsData;
};

export type BlockData = BlockDataMap[keyof BlockDataMap];

/**
 * Дискриминированная union-модель блока: сужение по `type`
 * автоматически уточняет тип `data` на клиенте.
 */
export type Block = {
  [K in BlockType]: {
    id: number;
    type: K;
    position: number;
    isVisible: boolean;
    /** HEX-цвет фона блока или null — тогда используется фон темы. */
    background: string | null;
    data: BlockDataMap[K];
  };
}[BlockType];

/**
 * Подбирает читаемый цвет текста для произвольного фона блока
 * по приближённой яркости HEX-цвета.
 */
export function foregroundFor(hex: string): string {
  let value = hex.replace("#", "");
  if (value.length === 3)
    value = value
      .split("")
      .map(char => char + char)
      .join("");
  const num = Number.parseInt(value, 16);
  if (!Number.isFinite(num)) return "#2b2b2b";
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#2b2b2b" : "#f5ede0";
}

export type BlockLibraryEntry<T extends BlockType = BlockType> = {
  type: T;
  label: string;
  description: string;
  defaults: BlockDataMap[T];
};

/** Библиотека блоков для диалога «Добавить блок» в админ-панели. */
export const BLOCK_LIBRARY: BlockLibraryEntry[] = [
  {
    type: "cover",
    label: "Обложка",
    description: "Первый экран: заголовок, текст, кнопка и фото в арке",
    defaults: {
      eyebrow: "Маленькие детали. Особенная атмосфера.",
      title: "Декор для дома ручной работы",
      text: "Керамика, свечи и уютные мелочи, созданные вручную в нашей мастерской.",
      buttonText: "Смотреть коллекцию",
      buttonLink: "#catalog",
      backgroundImage: "",
      align: "left",
      layout: "split",
      image: "",
      imagePosition: "right",
      imageFocus: "center",
      features: [
        { icon: "hand", title: "Ручная работа" },
        { icon: "leaf", title: "Натуральные материалы" },
        { icon: "gift", title: "Уютный подарок" },
      ],
    },
  },
  {
    type: "text",
    label: "Текстовый блок",
    description: "Заголовок и текст, узкая или широкая колонка",
    defaults: {
      title: "",
      text: "Текст блока. Пустая строка начинает новый абзац.",
      align: "left",
      narrow: true,
    },
  },
  {
    type: "features",
    label: "Плитка преимуществ",
    description: "Карточки в 2–4 колонки: заголовок и короткое описание",
    defaults: {
      title: "Почему мы",
      items: [
        { title: "Вручную", text: "Каждая вещь сделана вручную." },
        { title: "Локальная глина", text: "Только безопасные глазури." },
        { title: "Упаковка", text: "Три слоя крафта и стружки." },
      ],
      columns: 3,
    },
  },
  {
    type: "gallery",
    label: "Галерея",
    description: "Сетка изображений с подписями",
    defaults: { title: "Галерея", images: [], columns: 3 },
  },
  {
    type: "image",
    label: "Изображение",
    description: "Одно фото с подписью и выбором ширины",
    defaults: { src: "", caption: "", width: "large" },
  },
  {
    type: "video",
    label: "Видео",
    description: "Ролик YouTube или Vimeo по ссылке",
    defaults: { title: "", url: "" },
  },
  {
    type: "faq",
    label: "Вопросы и ответы",
    description: "Аккордеон со списком вопросов",
    defaults: {
      title: "Частые вопросы",
      items: [
        {
          question: "Как сделать заказ?",
          answer: "Добавьте товары в корзину.",
        },
      ],
    },
  },
  {
    type: "steps",
    label: "Этапы",
    description: "Нумерованные шаги: как мы работаем",
    defaults: {
      title: "Как рождается вещь",
      items: [
        { title: "Замес глины", text: "Готовим глину и формуем изделие." },
        { title: "Обжиг", text: "Сушим и обжигаем в печи." },
        { title: "Глазурь", text: "Покрываем глазурью и обжигаем снова." },
      ],
    },
  },
  {
    type: "about",
    label: "О мастерской",
    description: "Текст и фото процесса, преимущества и цитата",
    defaults: {
      title: "О мастерской",
      text: "",
      image: "",
      caption: "",
      quote: "",
      features: [],
    },
  },
  {
    type: "catalog",
    label: "Каталог коллекций",
    description: "Обложки коллекций из раздела «Коллекции» (один на сайт)",
    defaults: { title: "Каталог", text: "", columns: 4 },
  },
  {
    type: "products",
    label: "Товары",
    description: "Фильтры коллекций и карточки товаров (один на сайт)",
    defaults: { title: "" },
  },
  {
    type: "delivery",
    label: "Доставка",
    description: "Условия доставки: фото и информационные карточки",
    defaults: {
      title: "Доставка по всей России",
      text: "",
      image: "",
      cards: [
        { icon: "box", title: "Упаковка", text: "Три слоя крафта и стружки." },
        { icon: "truck", title: "Доставка", text: "СДЭК или Почта России." },
        { icon: "card", title: "Оплата", text: "Перевод после подтверждения." },
        { icon: "clock", title: "Сроки", text: "Отправляем за 2–3 дня." },
      ],
    },
  },
  {
    type: "contacts",
    label: "Контакты",
    description: "Кнопки Telegram, WhatsApp, ВКонтакте и email (один на сайт)",
    defaults: {
      title: "Остались вопросы?",
      text: "Напишите нам удобным способом — ответим в течение дня.",
      image: "",
    },
  },
];

export const BLOCK_LABELS: Record<BlockType, string> = Object.fromEntries(
  BLOCK_LIBRARY.map(entry => [entry.type, entry.label])
) as Record<BlockType, string>;

export function blockDefaults<T extends BlockType>(type: T): BlockDataMap[T] {
  const entry = BLOCK_LIBRARY.find(item => item.type === type);
  if (!entry) throw new Error(`Unknown block type: ${type}`);
  return structuredClone(entry.defaults) as BlockDataMap[T];
}

/**
 * Преобразует ссылку YouTube/Vimeo в embed-URL.
 * Возвращает null, если ссылка не распознаётся — рендерить видео не нужно.
 */
export function videoEmbedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  const ytId = "[A-Za-z0-9_-]{6,32}";
  if (host === "youtube.com" && parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v") ?? "";
    return new RegExp(`^${ytId}$`).test(id)
      ? `https://www.youtube.com/embed/${id}`
      : null;
  }
  if (host === "youtu.be" && new RegExp(`^/${ytId}$`).test(parsed.pathname)) {
    return `https://www.youtube.com/embed${parsed.pathname}`;
  }
  if (host === "vimeo.com" && /^\/\d{4,12}$/.test(parsed.pathname)) {
    return `https://player.vimeo.com/video${parsed.pathname}`;
  }
  return null;
}

import { ImageUpload } from "@/components/ImageUpload";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AboutData,
  Block,
  BlockData,
  CatalogData,
  ContactsData,
  CoverData,
  DeliveryData,
  FaqData,
  FeaturesData,
  GalleryData,
  IconKey,
  ImageData,
  ProductsData,
  StepsData,
  TextData,
  VideoData,
} from "@contracts/blocks";
import { ICON_KEYS, ICON_LABELS } from "@contracts/blocks";
import {
  ArrowDown,
  ArrowUp,
  CreditCard,
  Clock,
  Flame,
  Gift,
  Hand,
  Heart,
  Leaf,
  Package,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Truck,
} from "lucide-react";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

const ICON_COMPONENTS: Record<
  IconKey,
  React.ComponentType<{ className?: string }>
> = {
  leaf: Leaf,
  gift: Gift,
  truck: Truck,
  clock: Clock,
  hand: Hand,
  heart: Heart,
  star: Star,
  shield: Shield,
  box: Package,
  card: CreditCard,
  flame: Flame,
  sparkle: Sparkles,
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/uploads/….webp или https://…"
      />
      <ImageUpload onUpload={onChange} />
      {value && (
        <img
          src={value}
          alt=""
          className="mt-2 h-20 w-32 rounded object-cover border border-slate-200"
        />
      )}
    </div>
  );
}

/** Выбор иконки из безопасного набора контракта. */
function IconPicker({
  value,
  onChange,
}: {
  value: IconKey;
  onChange: (value: IconKey) => void;
}) {
  return (
    <div>
      <Label>Иконка</Label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {ICON_KEYS.map((key) => {
          const IconCmp = ICON_COMPONENTS[key];
          const active = key === value;
          return (
            <button
              key={key}
              type="button"
              title={ICON_LABELS[key]}
              aria-label={ICON_LABELS[key]}
              aria-pressed={active}
              onClick={() => onChange(key)}
              className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                active
                  ? "border-[#831C25] bg-[#831C25]/10 text-[#831C25]"
                  : "border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
            >
              <IconCmp className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Редактор списка однотипных элементов (плитка, этапы, FAQ, галерея). */
function ItemsEditor<T>({
  items,
  onChange,
  addLabel,
  render,
  max,
  defaults,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  addLabel: string;
  max: number;
  defaults?: T;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-md border border-slate-200 p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">#{index + 1}</span>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Переместить выше"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label="Переместить ниже"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-red-600 hover:text-red-700"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                aria-label="Удалить элемент"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {render(item, (next) =>
            onChange(items.map((v, i) => (i === index ? next : v))),
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={items.length >= max}
        onClick={() => onChange([...items, defaults ?? ({} as T)])}
      >
        + {addLabel}
      </Button>
    </div>
  );
}

function CoverForm({
  data,
  onChange,
}: {
  data: CoverData;
  onChange: (d: CoverData) => void;
}) {
  const set = <K extends keyof CoverData>(key: K, value: CoverData[K]) =>
    onChange({ ...data, [key]: value });
  const features = data.features ?? [];
  return (
    <div className="grid gap-4">
      <Field label="Надпись над заголовком (необязательно)">
        <Input
          value={data.eyebrow ?? ""}
          onChange={(e) => set("eyebrow", e.target.value)}
          placeholder="Маленькие детали. Особенная атмосфера."
        />
      </Field>
      <Field label="Заголовок">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Текст">
        <Textarea
          value={data.text}
          onChange={(e) => set("text", e.target.value)}
          rows={3}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Текст кнопки">
          <Input
            value={data.buttonText}
            onChange={(e) => set("buttonText", e.target.value)}
          />
        </Field>
        <Field label="Ссылка кнопки (якорь #…, /путь или https://…)">
          <Input
            value={data.buttonLink}
            onChange={(e) => set("buttonLink", e.target.value)}
            placeholder="#catalog"
          />
        </Field>
      </div>
      <ImageField
        label="Главное фото (арочная форма; необязательно)"
        value={data.image ?? ""}
        onChange={(image) => set("image", image)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Позиция главного фото">
          <select
            className={selectClass}
            value={data.imagePosition ?? "right"}
            onChange={(e) =>
              set("imagePosition", e.target.value as "left" | "right")
            }
          >
            <option value="right">Справа</option>
            <option value="left">Слева</option>
          </select>
        </Field>
        <Field label="Выравнивание (без главного фото)">
          <select
            className={selectClass}
            value={data.align}
            onChange={(e) => set("align", e.target.value as CoverData["align"])}
          >
            <option value="center">По центру</option>
            <option value="left">Слева</option>
          </select>
        </Field>
      </div>
      <ImageField
        label="Фоновое изображение (необязательно)"
        value={data.backgroundImage}
        onChange={(backgroundImage) => set("backgroundImage", backgroundImage)}
      />
      <Field label="Преимущества под текстом (до 4)">
        <ItemsEditor
          items={features}
          onChange={(items) => set("features", items)}
          addLabel="Добавить преимущество"
          max={4}
          defaults={{ icon: "leaf" as IconKey, title: "" }}
          render={(item, setItem) => (
            <div className="grid gap-2">
              <IconPicker
                value={item.icon ?? "leaf"}
                onChange={(icon) => setItem({ ...item, icon })}
              />
              <Input
                value={item.title ?? ""}
                onChange={(e) => setItem({ ...item, title: e.target.value })}
                placeholder="Ручная работа"
              />
            </div>
          )}
        />
      </Field>
    </div>
  );
}

function TextForm({
  data,
  onChange,
}: {
  data: TextData;
  onChange: (d: TextData) => void;
}) {
  const set = <K extends keyof TextData>(key: K, value: TextData[K]) =>
    onChange({ ...data, [key]: value });
  return (
    <div className="grid gap-4">
      <Field label="Заголовок (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Текст (пустая строка разделяет абзацы)">
        <Textarea
          value={data.text}
          onChange={(e) => set("text", e.target.value)}
          rows={8}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Выравнивание">
          <select
            className={selectClass}
            value={data.align}
            onChange={(e) => set("align", e.target.value as TextData["align"])}
          >
            <option value="left">Слева</option>
            <option value="center">По центру</option>
          </select>
        </Field>
        <Field label="Ширина">
          <select
            className={selectClass}
            value={data.narrow ? "narrow" : "wide"}
            onChange={(e) => set("narrow", e.target.value === "narrow")}
          >
            <option value="narrow">Узкая колонка</option>
            <option value="wide">Широкая колонка</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function FeaturesForm({
  data,
  onChange,
}: {
  data: FeaturesData;
  onChange: (d: FeaturesData) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <Field label="Колонок">
        <select
          className={selectClass}
          value={data.columns}
          onChange={(e) =>
            onChange({ ...data, columns: Number(e.target.value) as 2 | 3 | 4 })
          }
        >
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </Field>
      <ItemsEditor
        items={data.items}
        onChange={(items) => onChange({ ...data, items })}
        addLabel="Добавить плитку"
        max={6}
        render={(item, set) => (
          <div className="grid gap-2">
            <Input
              value={item.title ?? ""}
              onChange={(e) => set({ ...item, title: e.target.value })}
              placeholder="Заголовок"
            />
            <Textarea
              value={item.text ?? ""}
              onChange={(e) => set({ ...item, text: e.target.value })}
              rows={2}
              placeholder="Короткое описание"
            />
          </div>
        )}
      />
    </div>
  );
}

function GalleryForm({
  data,
  onChange,
}: {
  data: GalleryData;
  onChange: (d: GalleryData) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <Field label="Колонок">
        <select
          className={selectClass}
          value={data.columns}
          onChange={(e) =>
            onChange({ ...data, columns: Number(e.target.value) as 2 | 3 | 4 })
          }
        >
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </Field>
      <ItemsEditor
        items={data.images}
        onChange={(images) => onChange({ ...data, images })}
        addLabel="Добавить фото"
        max={24}
        render={(item, set) => (
          <div className="grid gap-2">
            <Input
              value={item.src ?? ""}
              onChange={(e) => set({ ...item, src: e.target.value })}
              placeholder="/uploads/….webp"
            />
            <ImageUpload onUpload={(src) => set({ ...item, src })} />
            {item.src && (
              <img
                src={item.src}
                alt=""
                className="h-16 w-24 rounded object-cover border border-slate-200"
              />
            )}
            <Input
              value={item.caption ?? ""}
              onChange={(e) => set({ ...item, caption: e.target.value })}
              placeholder="Подпись (необязательно)"
            />
          </div>
        )}
      />
    </div>
  );
}

function ImageForm({
  data,
  onChange,
}: {
  data: ImageData;
  onChange: (d: ImageData) => void;
}) {
  const set = <K extends keyof ImageData>(key: K, value: ImageData[K]) =>
    onChange({ ...data, [key]: value });
  return (
    <div className="grid gap-4">
      <ImageField
        label="Изображение"
        value={data.src}
        onChange={(src) => set("src", src)}
      />
      <Field label="Подпись (необязательно)">
        <Input
          value={data.caption}
          onChange={(e) => set("caption", e.target.value)}
        />
      </Field>
      <Field label="Ширина">
        <select
          className={selectClass}
          value={data.width}
          onChange={(e) => set("width", e.target.value as ImageData["width"])}
        >
          <option value="small">Узкая (480px)</option>
          <option value="medium">Средняя (720px)</option>
          <option value="large">Широкая (960px)</option>
          <option value="full">Во всю ширину</option>
        </select>
      </Field>
    </div>
  );
}

function VideoForm({
  data,
  onChange,
}: {
  data: VideoData;
  onChange: (d: VideoData) => void;
}) {
  const set = <K extends keyof VideoData>(key: K, value: VideoData[K]) =>
    onChange({ ...data, [key]: value });
  return (
    <div className="grid gap-4">
      <Field label="Заголовок (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Ссылка на видео (YouTube или Vimeo)">
        <Input
          value={data.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
        />
      </Field>
    </div>
  );
}

function FaqForm({
  data,
  onChange,
}: {
  data: FaqData;
  onChange: (d: FaqData) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <ItemsEditor
        items={data.items}
        onChange={(items) => onChange({ ...data, items })}
        addLabel="Добавить вопрос"
        max={30}
        render={(item, set) => (
          <div className="grid gap-2">
            <Input
              value={item.question ?? ""}
              onChange={(e) => set({ ...item, question: e.target.value })}
              placeholder="Вопрос"
            />
            <Textarea
              value={item.answer ?? ""}
              onChange={(e) => set({ ...item, answer: e.target.value })}
              rows={3}
              placeholder="Ответ"
            />
          </div>
        )}
      />
    </div>
  );
}

function StepsForm({
  data,
  onChange,
}: {
  data: StepsData;
  onChange: (d: StepsData) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции (необязательно)">
        <Input
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <ItemsEditor
        items={data.items}
        onChange={(items) => onChange({ ...data, items })}
        addLabel="Добавить этап"
        max={10}
        render={(item, set) => (
          <div className="grid gap-2">
            <Input
              value={item.title ?? ""}
              onChange={(e) => set({ ...item, title: e.target.value })}
              placeholder="Название этапа"
            />
            <Textarea
              value={item.text ?? ""}
              onChange={(e) => set({ ...item, text: e.target.value })}
              rows={2}
              placeholder="Описание"
            />
          </div>
        )}
      />
    </div>
  );
}

function AboutForm({
  data,
  onChange,
}: {
  data: AboutData;
  onChange: (d: AboutData) => void;
}) {
  const set = <K extends keyof AboutData>(key: K, value: AboutData[K]) =>
    onChange({ ...data, [key]: value });
  const features = data.features ?? [];
  return (
    <div className="grid gap-4">
      <Field label="Заголовок">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Текст (пустая строка разделяет абзацы)">
        <Textarea
          value={data.text}
          onChange={(e) => set("text", e.target.value)}
          rows={8}
        />
      </Field>
      <ImageField
        label="Фото процесса (необязательно)"
        value={data.image}
        onChange={(image) => set("image", image)}
      />
      <Field label="Подпись к фото (необязательно)">
        <Input
          value={data.caption ?? ""}
          onChange={(e) => set("caption", e.target.value)}
          placeholder="Мастерская, 2026"
        />
      </Field>
      <Field label="Преимущества под текстом (до 6)">
        <ItemsEditor
          items={features}
          onChange={(items) => set("features", items)}
          addLabel="Добавить преимущество"
          max={6}
          defaults={{ title: "", text: "" }}
          render={(item, setItem) => (
            <div className="grid gap-2">
              <Input
                value={item.title ?? ""}
                onChange={(e) => setItem({ ...item, title: e.target.value })}
                placeholder="Вручную"
              />
              <Textarea
                value={item.text ?? ""}
                onChange={(e) => setItem({ ...item, text: e.target.value })}
                rows={2}
                placeholder="Короткое описание"
              />
            </div>
          )}
        />
      </Field>
      <Field label="Декоративная цитата (необязательно)">
        <Textarea
          value={data.quote ?? ""}
          onChange={(e) => set("quote", e.target.value)}
          rows={2}
          placeholder="Каждая вещь хранит тепло рук"
        />
      </Field>
    </div>
  );
}

function CatalogForm({
  data,
  onChange,
}: {
  data: CatalogData;
  onChange: (d: CatalogData) => void;
}) {
  const set = <K extends keyof CatalogData>(key: K, value: CatalogData[K]) =>
    onChange({ ...data, [key]: value });
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Описание под заголовком (необязательно)">
        <Textarea
          value={data.text ?? ""}
          onChange={(e) => set("text", e.target.value)}
          rows={2}
        />
      </Field>
      <Field label="Картинок в ряду">
        <select
          className={selectClass}
          value={data.columns ?? 4}
          onChange={(e) => set("columns", Number(e.target.value) as 2 | 3 | 4)}
        >
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </Field>
      <p className="text-sm text-slate-500">
        Карточки категорий берутся из раздела «Коллекции»: название, описание,
        обложка, порядок и видимость настраиваются там.
      </p>
    </div>
  );
}

function ProductsForm({
  data,
  onChange,
}: {
  data: ProductsData;
  onChange: (d: ProductsData) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Заголовок секции (без активного фильтра)">
        <Input
          value={data.title ?? ""}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
          placeholder="Наши изделия"
        />
      </Field>
      <p className="text-sm text-slate-500">
        Фильтры «Все категории» и вкладки коллекций строятся из раздела
        «Коллекции»; карточки товаров — из раздела «Товары». При выбранной
        категории заголовок заменяется её названием.
      </p>
    </div>
  );
}

function DeliveryForm({
  data,
  onChange,
}: {
  data: DeliveryData;
  onChange: (d: DeliveryData) => void;
}) {
  const set = <K extends keyof DeliveryData>(key: K, value: DeliveryData[K]) =>
    onChange({ ...data, [key]: value });
  const cards = data.cards ?? [];
  return (
    <div className="grid gap-4">
      <Field label="Заголовок">
        <Input
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Текст (пустая строка разделяет абзацы)">
        <Textarea
          value={data.text}
          onChange={(e) => set("text", e.target.value)}
          rows={6}
        />
      </Field>
      <ImageField
        label="Фото упаковки (необязательно)"
        value={data.image ?? ""}
        onChange={(image) => set("image", image)}
      />
      <Field label="Информационные карточки (до 6)">
        <ItemsEditor
          items={cards}
          onChange={(items) => set("cards", items)}
          addLabel="Добавить карточку"
          max={6}
          defaults={{ icon: "truck" as IconKey, title: "", text: "" }}
          render={(item, setItem) => (
            <div className="grid gap-2">
              <IconPicker
                value={item.icon ?? "truck"}
                onChange={(icon) => setItem({ ...item, icon })}
              />
              <Input
                value={item.title ?? ""}
                onChange={(e) => setItem({ ...item, title: e.target.value })}
                placeholder="Доставка"
              />
              <Textarea
                value={item.text ?? ""}
                onChange={(e) => setItem({ ...item, text: e.target.value })}
                rows={2}
                placeholder="СДЭК или Почта России"
              />
            </div>
          )}
        />
      </Field>
    </div>
  );
}

function ContactsForm({
  data,
  onChange,
}: {
  data: ContactsData;
  onChange: (d: ContactsData) => void;
}) {
  const set = <K extends keyof ContactsData>(key: K, value: ContactsData[K]) =>
    onChange({ ...data, [key]: value });
  return (
    <div className="grid gap-4">
      <Field label="Заголовок (необязательно)">
        <Input
          value={data.title ?? ""}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Текст (необязательно)">
        <Textarea
          value={data.text ?? ""}
          onChange={(e) => set("text", e.target.value)}
          rows={3}
        />
      </Field>
      <ImageField
        label="Фото изделия (необязательно)"
        value={data.image ?? ""}
        onChange={(image) => set("image", image)}
      />
      <p className="text-sm text-slate-500">
        Кнопки Telegram, WhatsApp, ВКонтакте и email строятся из ссылок в
        разделе «Тексты и контакты»; пустые ссылки не показываются.
      </p>
    </div>
  );
}

/** Форма редактирования содержимого блока — выбирается по типу. */
export function BlockForm({
  block,
  data,
  onChange,
}: {
  block: Block;
  data: BlockData;
  onChange: (data: BlockData) => void;
}) {
  switch (block.type) {
    case "cover":
      return <CoverForm data={data as CoverData} onChange={onChange} />;
    case "text":
      return <TextForm data={data as TextData} onChange={onChange} />;
    case "features":
      return <FeaturesForm data={data as FeaturesData} onChange={onChange} />;
    case "gallery":
      return <GalleryForm data={data as GalleryData} onChange={onChange} />;
    case "image":
      return <ImageForm data={data as ImageData} onChange={onChange} />;
    case "video":
      return <VideoForm data={data as VideoData} onChange={onChange} />;
    case "faq":
      return <FaqForm data={data as FaqData} onChange={onChange} />;
    case "steps":
      return <StepsForm data={data as StepsData} onChange={onChange} />;
    case "about":
      return <AboutForm data={data as AboutData} onChange={onChange} />;
    case "catalog":
      return <CatalogForm data={data as CatalogData} onChange={onChange} />;
    case "products":
      return <ProductsForm data={data as ProductsData} onChange={onChange} />;
    case "delivery":
      return <DeliveryForm data={data as DeliveryData} onChange={onChange} />;
    case "contacts":
      return <ContactsForm data={data as ContactsData} onChange={onChange} />;
    default:
      return null;
  }
}

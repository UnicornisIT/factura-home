import { useState, type CSSProperties } from "react";
import type { Block, BlockType } from "@contracts/blocks";
import { foregroundFor, videoEmbedUrl } from "@contracts/blocks";
import {
  Icon,
  LeafDecor,
  MessengerIcon,
  type MessengerKind,
} from "@/components/Icon";

export type CatalogCollection = {
  id: number;
  slug: string;
  title: string;
  description: string;
  coverImage: string | null;
};

export type CatalogProduct = {
  id: number;
  collectionId: number;
  name: string;
  material: string | null;
  price: number;
  image: string | null;
};

export type ContactLinks = {
  telegram: string;
  whatsapp: string;
  vk: string;
  email: string;
};

export type BlockContextValue = {
  collections: CatalogCollection[];
  products: CatalogProduct[];
  /** null — фильтр «Все категории». */
  activeSlug: string | null;
  onSelectCollection: (slug: string | null) => void;
  onAddToCart: (product: { id: number; name: string; price: number }) => void;
  /** Legacy-якоря (catalog, about, delivery, products, contacts) → id элементов. */
  anchors: Record<string, string | undefined>;
  contacts: ContactLinks;
};

type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export function blockElementId(block: Block): string {
  return `block-${block.id}`;
}

function paragraphs(text: string) {
  return text
    .split("\n\n")
    .map(part => part.trim())
    .filter(Boolean);
}

function scrollToId(elementId: string | undefined) {
  if (!elementId) return;
  document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth" });
}

export function BlockRenderer({
  block,
  ctx,
}: {
  block: Block;
  ctx: BlockContextValue;
}) {
  const id = blockElementId(block);
  // Цвет фона блока задаётся переменными: секции используют
  // var(--block-bg/--block-fg, …) и без них выглядят как раньше.
  const style = block.background
    ? ({
        "--block-bg": block.background,
        "--block-fg": foregroundFor(block.background),
      } as CSSProperties)
    : undefined;
  return (
    <div className="block-slot" style={style}>
      {renderBlock(id, block, ctx)}
    </div>
  );
}

function renderBlock(id: string, block: Block, ctx: BlockContextValue) {
  switch (block.type) {
    case "cover":
      return <CoverBlock id={id} block={block} ctx={ctx} />;
    case "text":
      return <TextBlock id={id} block={block} />;
    case "features":
      return <FeaturesBlock id={id} block={block} />;
    case "gallery":
      return <GalleryBlock id={id} block={block} />;
    case "image":
      return <SingleImageBlock id={id} block={block} />;
    case "video":
      return <VideoBlock id={id} block={block} />;
    case "faq":
      return <FaqBlock id={id} block={block} />;
    case "steps":
      return <StepsBlock id={id} block={block} />;
    case "about":
      return <AboutBlock id={id} block={block} />;
    case "catalog":
      return <CatalogBlock id={id} block={block} ctx={ctx} />;
    case "products":
      return <ProductsBlock id={id} block={block} ctx={ctx} />;
    case "delivery":
      return <DeliveryBlock id={id} block={block} />;
    case "contacts":
      return <ContactsBlock id={id} block={block} ctx={ctx} />;
    default:
      return null;
  }
}

function CoverBlock({
  id,
  block,
  ctx,
}: {
  id: string;
  block: BlockOf<"cover">;
  ctx: BlockContextValue;
}) {
  const { data } = block;
  const link = data.buttonLink;
  const isAnchor = link.startsWith("#");
  const target = isAnchor
    ? (ctx.anchors[link.slice(1)] ?? link.slice(1))
    : link;
  const button =
    data.buttonText && link !== "" ? (
      isAnchor ? (
        <button className="btn" onClick={() => scrollToId(target)}>
          {data.buttonText}
        </button>
      ) : (
        <a className="btn" href={link}>
          {data.buttonText}
        </a>
      )
    ) : null;

  const content = (
    <>
      {data.eyebrow && <div className="cover-eyebrow">{data.eyebrow}</div>}
      <h1>{data.title}</h1>
      {data.text && <p>{data.text}</p>}
      {button}
      {data.features && data.features.length > 0 && (
        <div className="hero-features">
          {data.features.map((feature, index) => (
            <div className="hero-feature" key={index}>
              <span className="hero-feature-icon">
                <Icon name={feature.icon} size={18} />
              </span>
              <span>{feature.title}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // Явная компоновка из админки; без значения — по наличию главного фото.
  const layout = data.layout ?? (data.image ? "split" : "center");

  // Центрированная обложка — прежний вид для блоков без главного фото.
  if (layout === "center") {
    return (
      <section
        className={`hero block-cover${data.backgroundImage ? " has-bg" : ""}${
          data.align === "left" ? " align-left" : ""
        }`}
        id={id}
        style={
          data.backgroundImage
            ? { backgroundImage: `url(${data.backgroundImage})` }
            : undefined
        }
      >
        {data.backgroundImage && <div className="cover-overlay" />}
        <div className="cover-content">{content}</div>
      </section>
    );
  }

  const imageLeft = data.imagePosition === "left";
  const focus =
    data.imageFocus && data.imageFocus !== "center"
      ? `center ${data.imageFocus}`
      : undefined;
  const photo = (
    <div className="hero-photo">
      <div className="hero-photo-frame">
        {data.image ? (
          <img
            src={data.image}
            alt={data.title}
            fetchPriority="high"
            style={focus ? { objectPosition: focus } : undefined}
          />
        ) : (
          <div className="hero-photo-empty" aria-hidden="true">
            <LeafDecor className="hero-empty-leaf" />
          </div>
        )}
      </div>
      <LeafDecor className="hero-leaf hero-leaf-top" />
      <LeafDecor className="hero-leaf hero-leaf-bottom" />
    </div>
  );

  return (
    <section
      className={`hero hero-split${imageLeft ? " image-left" : ""}${
        data.backgroundImage ? " has-bg" : ""
      }`}
      id={id}
      style={
        data.backgroundImage
          ? { backgroundImage: `url(${data.backgroundImage})` }
          : undefined
      }
    >
      {data.backgroundImage && <div className="cover-overlay" />}
      {/* Многослойный декор: тёплые пятна света и размытые тени листвы. */}
      <div className="hero-decor" aria-hidden="true">
        <span className="hd-bokeh hd-bokeh-1" />
        <span className="hd-bokeh hd-bokeh-2" />
        <LeafDecor className="hd-blur hd-blur-top" />
        <LeafDecor className="hd-blur hd-blur-bottom" />
      </div>
      <div className="hero-text-wrap">
        <div className="hero-text">{content}</div>
      </div>
      {photo}
    </section>
  );
}

function TextBlock({ id, block }: { id: string; block: BlockOf<"text"> }) {
  const { data } = block;
  return (
    <section
      className={`block-text${data.narrow ? " narrow" : ""}${
        data.align === "center" ? " align-center" : ""
      }`}
      id={id}
    >
      {data.title && <h2>{data.title}</h2>}
      {paragraphs(data.text).map((para, index) => (
        <p key={index}>{para}</p>
      ))}
    </section>
  );
}

function FeaturesBlock({
  id,
  block,
}: {
  id: string;
  block: BlockOf<"features">;
}) {
  const { data } = block;
  return (
    <section className="block-features" id={id}>
      {data.title && <h2 className="section-title">{data.title}</h2>}
      <div className={`features-grid cols-${data.columns}`}>
        {data.items.map((item, index) => (
          <div className="feature-card" key={index}>
            <div className="feature-title">{item.title}</div>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GalleryBlock({
  id,
  block,
}: {
  id: string;
  block: BlockOf<"gallery">;
}) {
  const { data } = block;
  if (data.images.length === 0) return null;
  return (
    <section className="block-gallery" id={id}>
      {data.title && <h2 className="section-title">{data.title}</h2>}
      <div className={`gallery-grid cols-${data.columns}`}>
        {data.images.map((image, index) => (
          <figure key={index}>
            <img src={image.src} alt={image.caption} loading="lazy" />
            {image.caption && <figcaption>{image.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}

function SingleImageBlock({
  id,
  block,
}: {
  id: string;
  block: BlockOf<"image">;
}) {
  const { data } = block;
  if (!data.src) return null;
  return (
    <section className="block-image" id={id}>
      <figure className={`image-frame width-${data.width}`}>
        <img src={data.src} alt={data.caption} loading="lazy" />
        {data.caption && <figcaption>{data.caption}</figcaption>}
      </figure>
    </section>
  );
}

function VideoBlock({ id, block }: { id: string; block: BlockOf<"video"> }) {
  const { data } = block;
  const embed = videoEmbedUrl(data.url);
  if (!embed) return null;
  return (
    <section className="block-video" id={id}>
      {data.title && <h2 className="section-title">{data.title}</h2>}
      <div className="video-frame">
        <iframe
          src={embed}
          title={data.title || "Видео"}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </section>
  );
}

function FaqBlock({ id, block }: { id: string; block: BlockOf<"faq"> }) {
  const { data } = block;
  return (
    <section className="block-faq" id={id}>
      {data.title && <h2 className="section-title">{data.title}</h2>}
      <div className="faq-list">
        {data.items.map((item, index) => (
          <details key={index}>
            <summary>{item.question}</summary>
            <div className="faq-answer">
              {paragraphs(item.answer).map((para, part) => (
                <p key={part}>{para}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function StepsBlock({ id, block }: { id: string; block: BlockOf<"steps"> }) {
  const { data } = block;
  return (
    <section className="block-steps" id={id}>
      {data.title && <h2 className="section-title">{data.title}</h2>}
      <ol className="steps-list">
        {data.items.map((item, index) => (
          <li key={index}>
            <span className="step-number">{index + 1}</span>
            <div>
              <div className="step-title">{item.title}</div>
              <p>{item.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AboutBlock({ id, block }: { id: string; block: BlockOf<"about"> }) {
  const { data } = block;
  const features = data.features ?? [];
  return (
    <section className="about" id={id}>
      <div className="about-inner">
        <div className="about-text">
          <h2>{data.title}</h2>
          {paragraphs(data.text).map((para, index) => (
            <p key={index}>{para}</p>
          ))}
          {features.length > 0 && (
            <div className="about-features">
              {features.map((feature, index) => (
                <div className="about-feature" key={index}>
                  <div className="about-feature-title">{feature.title}</div>
                  <p>{feature.text}</p>
                </div>
              ))}
            </div>
          )}
          {data.quote && (
            <blockquote className="about-quote">«{data.quote}»</blockquote>
          )}
        </div>
        {data.image && (
          <div className="about-photo">
            <img src={data.image} alt={data.title} loading="lazy" />
            <LeafDecor className="about-leaf" />
            {data.caption && (
              <div className="about-caption">{data.caption}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CatalogBlock({
  id,
  block,
  ctx,
}: {
  id: string;
  block: BlockOf<"catalog">;
  ctx: BlockContextValue;
}) {
  const { data } = block;
  const requested = data.columns ?? 4;
  const count = ctx.collections.length;
  // Колонок не больше, чем коллекций: две категории занимают всю ширину,
  // а при пяти и более включается адаптивная сетка.
  const gridClass =
    count > 4
      ? "cols-auto"
      : `cols-${count === 0 ? requested : Math.min(requested, count)}`;
  return (
    <section className="collections" id={id}>
      <h2 className="section-title">{data.title}</h2>
      {data.text && <p className="section-subtitle">{data.text}</p>}
      <div className={`collections-grid ${gridClass}`}>
        {ctx.collections.map(collection => (
          <div className="collection-card" key={collection.id}>
            <button
              className="collection-card-inner"
              onClick={() => {
                ctx.onSelectCollection(collection.slug);
                scrollToId(ctx.anchors["products"]);
              }}
              aria-label={`Показать товары: ${collection.title}`}
            >
              <span className="collection-photo">
                {collection.coverImage && (
                  <img
                    src={collection.coverImage}
                    alt={collection.title}
                    loading="lazy"
                  />
                )}
              </span>
              <span className="collection-body">
                <span className="collection-titles">
                  <span className="collection-label">{collection.title}</span>
                  {collection.description && (
                    <span className="collection-desc">
                      {collection.description}
                    </span>
                  )}
                </span>
                <span className="collection-arrow" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductsBlock({
  id,
  block,
  ctx,
}: {
  id: string;
  block: BlockOf<"products">;
  ctx: BlockContextValue;
}) {
  const slug = ctx.activeSlug;
  const activeCollection = ctx.collections.find(item => item.slug === slug);
  const visible = activeCollection
    ? ctx.products.filter(
        product => product.collectionId === activeCollection.id
      )
    : ctx.products;
  const heading = activeCollection?.title || block.data.title || "Наши изделия";
  return (
    <section className="products" id={id}>
      <h2 className="section-title">{heading}</h2>
      {activeCollection?.description && (
        <p className="section-subtitle">{activeCollection.description}</p>
      )}
      <div className="tabs">
        <button
          className={`tab ${slug === null ? "active" : ""}`}
          onClick={() => ctx.onSelectCollection(null)}
        >
          Все категории
        </button>
        {ctx.collections.map(collection => (
          <button
            key={collection.id}
            className={`tab ${collection.slug === slug ? "active" : ""}`}
            onClick={() => ctx.onSelectCollection(collection.slug)}
          >
            {collection.title}
          </button>
        ))}
      </div>
      <div className="products-grid" key={slug ?? "all"}>
        {visible.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            onAdd={() => ctx.onAddToCart(product)}
          />
        ))}
        {visible.length === 0 && (
          <p className="products-empty">
            {activeCollection
              ? "В этой категории пока пусто"
              : "Товары скоро появятся"}
          </p>
        )}
      </div>
    </section>
  );
}

function DeliveryBlock({
  id,
  block,
}: {
  id: string;
  block: BlockOf<"delivery">;
}) {
  const { data } = block;
  const cards = data.cards ?? [];
  return (
    <section className="delivery" id={id}>
      <div className="delivery-inner">
        <div className="delivery-text">
          <h2>{data.title}</h2>
          {paragraphs(data.text).map((para, index) => (
            <p key={index}>{para}</p>
          ))}
        </div>
        {data.image && (
          <div className="delivery-photo">
            <img src={data.image} alt={data.title} loading="lazy" />
          </div>
        )}
      </div>
      {cards.length > 0 && (
        <div className="delivery-cards">
          {cards.map((card, index) => (
            <div className="delivery-card" key={index}>
              <span className="delivery-card-icon">
                <Icon name={card.icon} size={22} />
              </span>
              <div className="delivery-card-title">{card.title}</div>
              <p>{card.text}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ContactsBlock({
  id,
  block,
  ctx,
}: {
  id: string;
  block: BlockOf<"contacts">;
  ctx: BlockContextValue;
}) {
  const { data } = block;
  const allLinks: { href: string; label: string; kind: MessengerKind }[] = [
    { href: ctx.contacts.telegram, label: "Telegram", kind: "telegram" },
    { href: ctx.contacts.whatsapp, label: "WhatsApp", kind: "whatsapp" },
    { href: ctx.contacts.vk, label: "ВКонтакте", kind: "vk" },
    {
      href: ctx.contacts.email ? `mailto:${ctx.contacts.email}` : "",
      label: ctx.contacts.email,
      kind: "mail",
    },
  ];
  const links = allLinks.filter(link => link.href && link.label);
  return (
    <section className="contacts" id={id}>
      <div className="contacts-inner">
        <div className="contacts-text">
          {data.title && <h2>{data.title}</h2>}
          {data.text &&
            paragraphs(data.text).map((para, index) => (
              <p key={index}>{para}</p>
            ))}
          {links.length > 0 && (
            <div className="contacts-buttons">
              {links.map(link => (
                <a
                  className={`btn btn-contact ct-${link.kind}`}
                  key={link.label}
                  href={link.href}
                  target={
                    link.href.startsWith("mailto:") ? undefined : "_blank"
                  }
                  rel="noopener"
                >
                  <MessengerIcon
                    kind={link.kind}
                    size={link.kind === "vk" ? 21 : 18}
                  />
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
        {data.image && (
          <div className="contacts-photo">
            <img
              src={data.image}
              alt={data.title ?? "Контакты"}
              loading="lazy"
            />
            <LeafDecor className="contacts-leaf" />
          </div>
        )}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  onAdd,
}: {
  product: {
    id: number;
    name: string;
    price: number;
    material: string | null;
    image: string | null;
  };
  onAdd: () => void;
}) {
  const [added, setAdded] = useState(false);
  return (
    <div className="card">
      <div className="card-photo">
        {product.image && (
          <img src={product.image} alt={product.name} loading="lazy" />
        )}
      </div>
      <div className="card-body">
        <div className="card-info">
          <div className="card-name">{product.name}</div>
          {product.material && (
            <div className="card-material">{product.material}</div>
          )}
          <div className="card-price">
            {product.price.toLocaleString("ru-RU")} ₽
          </div>
        </div>
        <button
          className={`card-buy ${added ? "added" : ""}`}
          onClick={() => {
            onAdd();
            setAdded(true);
            setTimeout(() => setAdded(false), 1200);
          }}
          aria-label={`Добавить «${product.name}» в корзину`}
        >
          {added ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

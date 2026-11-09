import { useState, type CSSProperties } from "react";
import type { Block, BlockType } from "@contracts/blocks";
import { foregroundFor, videoEmbedUrl } from "@contracts/blocks";

export type CatalogCollection = {
  id: number;
  slug: string;
  title: string;
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

export type BlockContextValue = {
  collections: CatalogCollection[];
  products: CatalogProduct[];
  activeSlug: string | null;
  onSelectCollection: (slug: string) => void;
  onAddToCart: (product: { id: number; name: string; price: number }) => void;
  /** Legacy-якоря (catalog, about, delivery, products) → id элементов. */
  anchors: Record<string, string | undefined>;
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
      return <ProductsBlock id={id} ctx={ctx} />;
    case "delivery":
      return <DeliveryBlock id={id} block={block} />;
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
      <div className="cover-content">
        <h1>{data.title}</h1>
        {data.text && <p>{data.text}</p>}
        {data.buttonText &&
          link !== "" &&
          (isAnchor ? (
            <button className="btn" onClick={() => scrollToId(target)}>
              {data.buttonText}
            </button>
          ) : (
            <a className="btn" href={link}>
              {data.buttonText}
            </a>
          ))}
      </div>
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
  return (
    <section className="about" id={id}>
      <div className="about-inner">
        <div>
          <h2>{data.title}</h2>
          {paragraphs(data.text).map((para, index) => (
            <p key={index}>{para}</p>
          ))}
        </div>
        {data.image && (
          <div className="about-photo">
            <img src={data.image} alt={data.title} loading="lazy" />
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
  return (
    <section className="collections" id={id}>
      <h2 className="section-title">{data.title}</h2>
      <div className="collections-grid">
        {ctx.collections.map(collection => (
          <button
            key={collection.id}
            className="collection-card"
            onClick={() => {
              ctx.onSelectCollection(collection.slug);
              scrollToId(ctx.anchors["products"]);
            }}
          >
            {collection.coverImage && (
              <img
                src={collection.coverImage}
                alt={collection.title}
                loading="lazy"
              />
            )}
            <span className="collection-label">{collection.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProductsBlock({ id, ctx }: { id: string; ctx: BlockContextValue }) {
  const slug = ctx.activeSlug ?? ctx.collections[0]?.slug ?? null;
  const activeCollection = ctx.collections.find(item => item.slug === slug);
  const visible = ctx.products.filter(
    product => product.collectionId === activeCollection?.id
  );
  return (
    <section className="products" id={id}>
      <div className="tabs">
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
      <div className="products-grid">
        {visible.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            onAdd={() => ctx.onAddToCart(product)}
          />
        ))}
        {visible.length === 0 && (
          <p
            style={{
              gridColumn: "1 / -1",
              textAlign: "center",
              color: "var(--text-soft)",
              padding: "40px 0",
            }}
          >
            В этой коллекции пока пусто
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
  return (
    <section className="delivery" id={id}>
      <h2>{data.title}</h2>
      {paragraphs(data.text).map((para, index) => (
        <p key={index}>{para}</p>
      ))}
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
        <div className="card-name">{product.name}</div>
        <div className="card-material">{product.material}</div>
        <button
          className={`card-buy ${added ? "added" : ""}`}
          onClick={() => {
            onAdd();
            setAdded(true);
            setTimeout(() => setAdded(false), 1200);
          }}
        >
          {added ? "Добавлено ✓" : `${product.price.toLocaleString("ru-RU")} ₽`}
        </button>
      </div>
    </div>
  );
}

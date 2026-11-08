import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";

type CartItem = { productId: number; name: string; price: number; qty: number };

export default function Home() {
  const { data: content } = trpc.content.get.useQuery();
  const { data: collections } = trpc.collections.list.useQuery();
  const { data: products } = trpc.products.list.useQuery();

  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderName, setOrderName] = useState("");
  const [contact, setContact] = useState("");
  const [comment, setComment] = useState("");
  const [receipt, setReceipt] = useState("");
  const order = trpc.orders.create.useMutation({
    onSuccess: saved => {
      setReceipt(
        `Заказ №${saved.id} принят. Сумма: ${saved.total.toLocaleString("ru-RU")} ₽. Мы свяжемся с вами для подтверждения доставки.`
      );
      setCart([]);
    },
  });

  const slug = activeSlug ?? collections?.[0]?.slug ?? null;
  const activeCollection = collections?.find(c => c.slug === slug);
  const visibleProducts = useMemo(
    () => (products ?? []).filter(p => p.collectionId === activeCollection?.id),
    [products, activeCollection]
  );

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const addToCart = (p: { id: number; name: string; price: number }) => {
    setCart(prev => {
      const existing = prev.find(i => i.productId === p.id);
      if (existing) {
        return prev.map(i =>
          i.productId === p.id ? { ...i, qty: Math.min(i.qty + 1, 50) } : i
        );
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, price: p.price, qty: 1 },
      ];
    });
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div style={{ background: "var(--cream)", minHeight: "100vh" }}>
      {/* Шапка */}
      <header className="header">
        <a className="logo" href="#top">
          {content?.shopName ?? "Глиняная мастерская"}
        </a>
        <nav className="nav">
          <a href="#about">О мастерской</a>
          <a href="#catalog">Каталог</a>
          <a href="#delivery">Доставка</a>
          <a href="#contacts">Контакты</a>
        </nav>
        <button className="cart-btn" onClick={() => setCartOpen(true)}>
          Корзина
          {cartCount > 0 && (
            <span className="cart-count visible">{cartCount}</span>
          )}
        </button>
      </header>

      {/* Hero */}
      <section className="hero" id="top">
        <h1>{content?.heroTitle}</h1>
        <p>{content?.heroText}</p>
        <button className="btn" onClick={() => scrollTo("catalog")}>
          Каталог
        </button>
      </section>

      {/* О мастерской */}
      <section className="about" id="about">
        <div className="about-inner">
          <div>
            <h2>{content?.aboutTitle}</h2>
            {(content?.aboutText ?? "").split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          {content?.aboutImage && (
            <div className="about-photo">
              <img src={content.aboutImage} alt="Мастерская" loading="lazy" />
            </div>
          )}
        </div>
      </section>

      {/* Каталог: обложки коллекций */}
      <section className="collections" id="catalog">
        <h2 className="section-title">Каталог</h2>
        <div className="collections-grid">
          {(collections ?? []).map(c => (
            <button
              key={c.id}
              className="collection-card"
              onClick={() => {
                setActiveSlug(c.slug);
                scrollTo("products");
              }}
            >
              {c.coverImage && (
                <img src={c.coverImage} alt={c.title} loading="lazy" />
              )}
              <span className="collection-label">{c.title}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Товары */}
      <section className="products" id="products">
        <div className="tabs">
          {(collections ?? []).map(c => (
            <button
              key={c.id}
              className={`tab ${c.slug === slug ? "active" : ""}`}
              onClick={() => setActiveSlug(c.slug)}
            >
              {c.title}
            </button>
          ))}
        </div>

        <div className="products-grid">
          {visibleProducts.map(p => (
            <ProductCard key={p.id} product={p} onAdd={() => addToCart(p)} />
          ))}
          {visibleProducts.length === 0 && (
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

      {/* Доставка */}
      <section className="delivery" id="delivery">
        <h2>{content?.deliveryTitle}</h2>
        <p>{content?.deliveryText}</p>
      </section>

      {/* Футер */}
      <footer className="footer" id="contacts">
        <div className="footer-inner">
          <div className="footer-cta">{content?.footerCta}</div>
          <div className="footer-links">
            {content?.telegram && (
              <a href={content.telegram} target="_blank" rel="noopener">
                Telegram
              </a>
            )}
            {content?.whatsapp && (
              <a href={content.whatsapp} target="_blank" rel="noopener">
                WhatsApp
              </a>
            )}
            {content?.email && (
              <a href={`mailto:${content.email}`}>{content.email}</a>
            )}
          </div>
        </div>
      </footer>

      {/* Корзина */}
      <div
        className={`cart-modal ${cartOpen ? "open" : ""}`}
        onClick={e => e.target === e.currentTarget && setCartOpen(false)}
      >
        <div className="cart-box" style={{ position: "relative" }}>
          <button
            className="cart-close"
            onClick={() => setCartOpen(false)}
            aria-label="Закрыть"
          >
            ×
          </button>
          <h3>Ваш заказ</h3>
          <div>
            {cart.length === 0 && (
              <p style={{ color: "var(--text-soft)", padding: "12px 0" }}>
                Пока пусто
              </p>
            )}
            {cart.map(item => (
              <div className="cart-item" key={item.productId}>
                <span>
                  {item.name}
                  {item.qty > 1 ? ` × ${item.qty}` : ""}
                </span>
                <span>{(item.price * item.qty).toLocaleString("ru-RU")} ₽</span>
              </div>
            ))}
          </div>
          <div className="cart-total">
            <span>Итого</span>
            <span>{cartTotal.toLocaleString("ru-RU")} ₽</span>
          </div>
          <p className="cart-note">
            Стоимость доставки и наличие подтвердим после получения заказа.
          </p>
          {receipt && <p role="status">{receipt}</p>}
          {cart.length > 0 && (
            <form
              className="cart-actions"
              onSubmit={event => {
                event.preventDefault();
                order.mutate({
                  name: orderName,
                  contact,
                  comment,
                  items: cart.map(({ productId, qty }) => ({ productId, qty })),
                });
              }}
            >
              <label>
                Ваше имя
                <input
                  required
                  maxLength={100}
                  value={orderName}
                  onChange={event => setOrderName(event.target.value)}
                />
              </label>
              <label>
                Телефон, Telegram или email
                <input
                  required
                  maxLength={320}
                  value={contact}
                  onChange={event => setContact(event.target.value)}
                />
              </label>
              <label>
                Комментарий
                <textarea
                  maxLength={2000}
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                />
              </label>
              {order.error && <p role="alert">{order.error.message}</p>}
              <button className="btn" type="submit" disabled={order.isPending}>
                {order.isPending ? "Отправка…" : "Оформить заказ"}
              </button>
            </form>
          )}
          <div className="cart-actions">
            {content?.telegram && (
              <a
                className="btn"
                href={content.telegram}
                target="_blank"
                rel="noopener"
                style={{ textAlign: "center" }}
              >
                Написать в Telegram
              </a>
            )}
            <button className="btn btn-outline" onClick={() => setCart([])}>
              Очистить корзину
            </button>
          </div>
        </div>
      </div>
    </div>
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

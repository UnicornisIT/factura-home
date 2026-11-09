import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  BlockRenderer,
  blockElementId,
  type BlockContextValue,
} from "@/components/blocks/BlockRenderer";

type CartItem = { productId: number; name: string; price: number; qty: number };

export default function Home() {
  const { data: content } = trpc.content.get.useQuery();
  const { data: collections } = trpc.collections.list.useQuery();
  const { data: products } = trpc.products.list.useQuery();
  const { data: blocks } = trpc.blocks.list.useQuery();

  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const visibleBlocks = useMemo(() => blocks ?? [], [blocks]);

  // Якоря навигации: legacy-имена разделов → id соответствующих блоков.
  const anchors = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const block of visibleBlocks) {
      if (block.type === "about") map["about"] ??= blockElementId(block);
      if (block.type === "catalog") map["catalog"] ??= blockElementId(block);
      if (block.type === "delivery") map["delivery"] ??= blockElementId(block);
      if (block.type === "products") map["products"] ??= blockElementId(block);
    }
    return map;
  }, [visibleBlocks]);

  const navLinks = useMemo(() => {
    const links: { href: string; label: string }[] = [];
    for (const block of visibleBlocks) {
      if (block.type === "about")
        links.push({
          href: `#${blockElementId(block)}`,
          label: block.data.title || "О мастерской",
        });
      if (block.type === "catalog")
        links.push({
          href: `#${blockElementId(block)}`,
          label: block.data.title || "Каталог",
        });
      if (block.type === "delivery")
        links.push({
          href: `#${blockElementId(block)}`,
          label: block.data.title || "Доставка",
        });
    }
    links.push({ href: "#contacts", label: "Контакты" });
    return links;
  }, [visibleBlocks]);

  const blockContext: BlockContextValue = {
    collections: collections ?? [],
    products: products ?? [],
    activeSlug,
    onSelectCollection: setActiveSlug,
    onAddToCart: addToCart,
    anchors,
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div style={{ background: "var(--cream)", minHeight: "100vh" }}>
      {/* Шапка */}
      <header className="header">
        <a className="logo" href="#top">
          {content?.shopName ?? "Глиняная мастерская"}
        </a>
        <nav className={`nav ${menuOpen ? "open" : ""}`}>
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button className="cart-btn" onClick={() => setCartOpen(true)}>
            Корзина
            {cartCount > 0 && (
              <span className="cart-count visible">{cartCount}</span>
            )}
          </button>
          <button
            className={`burger ${menuOpen ? "open" : ""}`}
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      <div id="top" />

      {/* Блоки страницы в порядке, заданном в конструкторе */}
      {visibleBlocks.map(block => (
        <BlockRenderer key={block.id} block={block} ctx={blockContext} />
      ))}

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

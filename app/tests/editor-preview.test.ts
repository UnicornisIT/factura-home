import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockDefaults } from "@contracts/blocks";
import EditorPreview from "../src/pages/EditorPreview";
import Home from "../src/pages/Home";

const queries = vi.hoisted(() => ({
  draft: vi.fn(),
  list: vi.fn(),
  createOrder: vi.fn(),
  cart: [] as { productId: number; name: string; qty: number; price: number }[],
}));

vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      react.useState(Array.isArray(initial) ? queries.cart : initial),
  };
});

vi.mock("@/providers/trpc", () => ({
  trpc: {
    content: { get: { useQuery: () => ({ data: { shopName: "Магазин" } }) } },
    collections: { list: { useQuery: () => ({ data: [] }) } },
    products: { list: { useQuery: () => ({ data: [] }) } },
    blocks: {
      draft: { get: { useQuery: queries.draft } },
      list: { useQuery: queries.list },
    },
    orders: {
      create: { useMutation: () => ({ mutateAsync: queries.createOrder }) },
    },
  },
}));

function textBlock(id: number, title: string, isVisible = true) {
  return {
    id,
    type: "text" as const,
    isVisible,
    position: 1,
    background: null,
    data: { ...blockDefaults("text"), title },
  };
}

beforeEach(() => {
  queries.draft.mockReturnValue({
    isSuccess: true,
    data: {
      blocks: [
        textBlock(-2, "Только в черновике"),
        textBlock(-3, "Скрытый блок", false),
      ],
    },
  });
  queries.list.mockReturnValue({ data: [textBlock(1, "Сейчас в магазине")] });
  queries.cart = [];
});

describe("storefront preview", () => {
  it("renders the visible draft through the storefront with its actual navigation and branding", () => {
    const html = renderToStaticMarkup(createElement(EditorPreview));
    expect(html).toContain("Предпросмотр — неопубликованная версия");
    expect(html).toContain("Только в черновике");
    expect(html).toContain('id="block--2"');
    expect(html).toContain("Магазин");
    expect(html).not.toContain("Скрытый блок");
    expect(html).not.toContain("Сейчас в магазине");
  });

  it("renders the publication in comparison mode", () => {
    const html = renderToStaticMarkup(
      createElement(EditorPreview, { published: true })
    );
    expect(html).toContain("Предпросмотр — опубликованная версия");
    expect(html).toContain("Сейчас в магазине");
    expect(html).not.toContain("Только в черновике");
  });

  it("locks preview when the administrator query is denied", () => {
    queries.draft.mockReturnValue({ isError: true });
    const html = renderToStaticMarkup(createElement(EditorPreview));
    expect(html).toContain("требуется доступ администратора");
    expect(html).not.toContain("Только в черновике");
  });

  it("renders the cart without an order form in either preview mode", () => {
    queries.cart = [{ productId: 1, name: "Кружка", qty: 1, price: 1000 }];
    for (const published of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(EditorPreview, { published })
      );
      expect(html).toContain("Кружка");
      expect(html).toContain("Оформление заказа отключено");
      expect(html).not.toContain("<form");
    }
    expect(renderToStaticMarkup(createElement(Home))).toContain("<form");
    expect(queries.createOrder).not.toHaveBeenCalled();
  });
});

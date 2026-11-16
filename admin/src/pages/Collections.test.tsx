import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Collections from "./Collections";
import Products from "./Products";

const { invalidateCollections, useCounts, useDelete } = vi.hoisted(() => ({
  invalidateCollections: vi.fn(),
  useCounts: vi.fn(),
  useDelete: vi.fn(),
}));

const collections = [
  { id: 123, title: "Осенняя коллекция", slug: "autumn", productCount: 2 },
  { id: 124, title: "Весенняя коллекция", slug: "spring", productCount: 1 },
  { id: 125, title: "Зимняя коллекция", slug: "winter", productCount: 0 },
];

const products = [
  { id: 1, name: "Ваза", price: 100, collectionId: 123, isActive: true },
  { id: 2, name: "Тарелка", price: 200, collectionId: 123, isActive: false },
  { id: 3, name: "Чашка", price: 300, collectionId: 124, isActive: true },
];

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({
    children,
    description,
  }: {
    children: React.ReactNode;
    description?: string;
  }) => (
    <>
      {description && <p>{description}</p>}
      {children}
    </>
  ),
}));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ collections: { invalidate: invalidateCollections } }),
    collections: {
      listWithProductCounts: { useQuery: useCounts },
      list: { useQuery: () => ({ data: collections, isSuccess: true }) },
      create: { useMutation: () => ({}) },
      update: { useMutation: () => ({}) },
      delete: { useMutation: useDelete },
    },
    products: {
      listAll: { useQuery: () => ({ data: products, isSuccess: true }) },
      create: { useMutation: () => ({}) },
      update: { useMutation: () => ({}) },
      delete: { useMutation: () => ({}) },
    },
  },
}));

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return (
    <output aria-label="Текущий URL">
      {pathname}
      {search}
    </output>
  );
}

function renderPage(url = "/collections") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CurrentUrl />
      <Routes>
        <Route path="/collections" element={<Collections />} />
        <Route path="/products" element={<Products />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mutate = vi.fn();

beforeEach(() => {
  mutate.mockReset();
  invalidateCollections.mockReset();
  useCounts.mockReturnValue({ data: collections });
  useDelete.mockReturnValue({ mutate, reset: vi.fn() });
});
afterEach(cleanup);

it("opens the filtered list with both active and hidden products", () => {
  renderPage();
  const count = screen.getByRole("link", { name: "Товаров: 2" });
  expect(count.getAttribute("href")).toBe("/products?collectionId=123");
  fireEvent.click(count);

  expect(screen.getByLabelText("Текущий URL").textContent).toBe(
    "/products?collectionId=123",
  );
  expect(screen.getByText("Фильтр: Осенняя коллекция")).toBeTruthy();
  expect(screen.getByRole("row", { name: /Ваза.*Виден/ })).toBeTruthy();
  expect(screen.getByRole("row", { name: /Тарелка.*Скрыт/ })).toBeTruthy();
  expect(screen.queryByText("Чашка")).toBeNull();
});

it("restores the filter from a direct URL and clears only collectionId", () => {
  renderPage("/products?collectionId=124&view=table");
  expect(screen.getByText("Фильтр: Весенняя коллекция")).toBeTruthy();
  expect(screen.getByText("Чашка")).toBeTruthy();
  expect(screen.queryByText("Ваза")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтр" }));
  expect(screen.getByLabelText("Текущий URL").textContent).toBe(
    "/products?view=table",
  );
  expect(screen.queryByText(/Фильтр:/)).toBeNull();
  expect(screen.getByText("Ваза")).toBeTruthy();
  expect(screen.getByText("Тарелка")).toBeTruthy();
  expect(screen.getByText("Чашка")).toBeTruthy();
});

it("opens an empty collection through its zero count", () => {
  renderPage();
  fireEvent.click(screen.getByRole("link", { name: "0 товаров" }));
  expect(screen.getByText("Фильтр: Зимняя коллекция")).toBeTruthy();
  expect(screen.getByText("В этой коллекции пока нет товаров")).toBeTruthy();
});

it.each(["999", "invalid"])(
  "explains that collectionId=%s was not found",
  (id) => {
    renderPage(`/products?collectionId=${id}`);
    expect(screen.getByRole("alert").textContent).toMatch(
      /Коллекция не найдена/,
    );
    expect(screen.queryByText("Ваза")).toBeNull();
  },
);

it("shows loading and never displays a stale zero after a count error", () => {
  useCounts.mockReturnValue({ isPending: true, isFetching: true });
  const page = renderPage();
  expect(screen.getByText("Загрузка коллекций и счётчиков…")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "0 товаров" })).toBeNull();
  page.unmount();

  useCounts.mockReturnValue({ data: collections, isError: true });
  renderPage();
  expect(screen.getByRole("alert").textContent).toMatch(/Удаление недоступно/);
  expect(screen.queryByRole("link", { name: "0 товаров" })).toBeNull();
  for (const button of screen.getAllByRole<HTMLButtonElement>("button", {
    name: "Удалить",
  })) {
    expect(button.disabled).toBe(true);
  }
});

it("blocks deletion for collections with products and requires confirmation for an empty one", () => {
  renderPage();
  const buttons = screen.getAllByRole<HTMLButtonElement>("button", {
    name: "Удалить",
  });
  expect(buttons.map((button) => button.disabled)).toEqual([true, true, false]);
  expect(
    screen.getAllByText("Удаление недоступно, пока в коллекции есть товары."),
  ).toHaveLength(2);

  fireEvent.click(buttons[2]);
  const dialog = screen.getByRole("dialog", { name: "Удалить коллекцию?" });
  expect(within(dialog).getByText(/«Зимняя коллекция»/)).toBeTruthy();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mutate).not.toHaveBeenCalled();

  fireEvent.click(buttons[2]);
  fireEvent.click(screen.getByRole("button", { name: "Удалить коллекцию" }));
  expect(mutate).toHaveBeenCalledExactlyOnceWith({ id: 125 });
});

it("refreshes the collection list and closes the dialog after deletion", async () => {
  useCounts.mockReturnValue({ data: [collections[2]] });
  invalidateCollections.mockImplementation(async () => {
    useCounts.mockReturnValue({ data: [] });
  });
  useDelete.mockImplementation(
    ({ onSuccess }: { onSuccess: () => Promise<void> }) => ({
      reset: vi.fn(),
      mutate: () => void onSuccess(),
    }),
  );
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить коллекцию" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(invalidateCollections).toHaveBeenCalledOnce();
  expect(screen.getByText("0 коллекций в каталоге")).toBeTruthy();
  expect(
    screen.getByText("Коллекций пока нет — добавьте первую."),
  ).toBeTruthy();
});

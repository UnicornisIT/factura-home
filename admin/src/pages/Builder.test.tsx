import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockDefaults, type Block } from "@contracts/blocks";
import Builder from "./Builder";

type Draft = { version: number; hasChanges: boolean; blocks: Block[] };
const api = vi.hoisted(() => ({
  query: {} as { data: Draft; refetch: ReturnType<typeof vi.fn> },
  save: vi.fn(),
  publish: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({
      blocks: {
        draft: {
          get: {
            setData: (_: undefined, data: Draft) => {
              api.query.data = data;
            },
          },
        },
      },
    }),
    blocks: {
      draft: {
        get: { useQuery: () => api.query },
        save: { useMutation: () => ({ mutate: api.save }) },
        publish: { useMutation: () => ({ mutate: api.publish }) },
        restore: { useMutation: () => ({ mutate: api.restore }) },
      },
    },
  },
}));

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => (
    <main>
      <Link to="/products">Товары</Link>
      {children}
    </main>
  ),
}));

vi.mock("@/components/builder/StorefrontPreview", () => ({
  StorefrontPreview: ({ blocks }: { blocks: Block[] }) => (
    <div>
      {blocks
        .filter((block) => block.isVisible)
        .map((block) => block.id)
        .join(",") || "Пустой предпросмотр"}
    </div>
  ),
}));

function openEditor() {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: "/builder", element: <Builder /> },
          { path: "/products", element: <p>Каталог товаров</p> },
        ],
        { initialEntries: ["/builder"] },
      )}
    />,
  );
}

const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { name });

beforeEach(() => {
  api.query.data = {
    version: 3,
    hasChanges: false,
    blocks: [
      {
        id: 12,
        type: "text",
        position: 1,
        isVisible: true,
        background: null,
        data: blockDefaults("text"),
      },
    ],
  };
  api.query.refetch = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("home page editor", () => {
  it("previews local edits immediately and publishes only a confirmed, saved version", () => {
    openEditor();
    expect(button("Опубликовать").disabled).toBe(true);
    fireEvent.click(button("Скрыть блок"));
    expect(screen.getByText("Пустой предпросмотр")).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(button("Сохранить черновик"));
    const [input, callbacks] = api.save.mock.lastCall!;
    expect(input).toMatchObject({
      version: 3,
      blocks: [{ id: 12, isVisible: false }],
    });
    expect(button("Опубликовать").disabled).toBe(true);
    act(() =>
      callbacks.onSuccess({
        version: 4,
        hasChanges: true,
        blocks: input.blocks,
      }),
    );
    expect(screen.getByText("Черновик сохранён")).toBeTruthy();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(button("Опубликовать"));
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(button("Опубликовать"));
    expect(api.publish.mock.lastCall?.[0]).toEqual({ version: 4 });
  });

  it("keeps local changes on a version conflict and warns before navigating away", () => {
    openEditor();
    fireEvent.click(button("Скрыть блок"));
    fireEvent.click(button("Сохранить черновик"));
    const [, callbacks] = api.save.mock.lastCall!;
    act(() =>
      callbacks.onError({
        data: { code: "CONFLICT" },
        message: "Черновик изменился.",
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Черновик изменился.",
    );
    expect(button("Загрузить актуальный черновик")).toBeTruthy();
    expect(button("Сохранить черновик").disabled).toBe(true);
    expect(screen.getByText("Пустой предпросмотр")).toBeTruthy();

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("link", { name: "Товары" }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("несохранённые изменения"),
    );
    expect(screen.queryByText("Каталог товаров")).toBeNull();
  });
});

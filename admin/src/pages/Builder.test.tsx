import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockDefaults,
  ICON_KEYS,
  ICON_LABELS,
  type Block,
} from "@contracts/blocks";
import { Icon } from "@server/src/components/Icon";
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
  AdminLayout: ({
    children,
    onBeforeLogout,
  }: {
    children: React.ReactNode;
    onBeforeLogout: () => boolean;
  }) => {
    const navigate = useNavigate();
    return (
      <main>
        <Link to="/products">Товары</Link>
        <Link to="/login?switch=1">Войти в другой аккаунт</Link>
        <button
          type="button"
          onClick={() => {
            if (onBeforeLogout())
              void navigate("/login", {
                replace: true,
                state: { loggedOut: true },
              });
          }}
        >
          Выйти
        </button>
        {children}
      </main>
    );
  },
}));

vi.mock("@/components/builder/StorefrontPreview", () => ({
  StorefrontPreview: ({ blocks }: { blocks: Block[] }) => (
    <div>
      {blocks
        .filter((block) => block.isVisible)
        .map((block) => block.id)
        .join(",") || "Пустой предпросмотр"}
      <output aria-label="Иконка в предпросмотре">
        {blocks.map((block) => {
          if (block.type === "cover") return block.data.features?.[0]?.icon;
          if (block.type === "delivery") return block.data.cards?.[0]?.icon;
        })}
      </output>
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
          { path: "/login", element: <p>Страница входа</p> },
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
  it.each(["cover", "delivery"] as const)(
    "uses storefront icons and previews and saves the selected key in %s",
    (type) => {
      const block = { id: 12, position: 1, isVisible: true, background: null };
      api.query.data.blocks = [
        type === "cover"
          ? {
              ...block,
              type,
              data: {
                ...blockDefaults(type),
                features: [{ icon: "leaf", title: "Преимущество" }],
              },
            }
          : {
              ...block,
              type,
              data: {
                ...blockDefaults(type),
                cards: [{ icon: "leaf", title: "Условия", text: "Описание" }],
              },
            },
      ];
      const preview = () =>
        screen.getByLabelText("Иконка в предпросмотре").textContent;
      openEditor();
      fireEvent.click(button("Редактировать блок"));
      expect(button(ICON_LABELS.leaf).getAttribute("aria-pressed")).toBe(
        "true",
      );

      for (const key of ICON_KEYS) {
        const option = screen.getByLabelText<HTMLButtonElement>(
          ICON_LABELS[key],
          { selector: "button" },
        );
        expect(option.title).toBe(ICON_LABELS[key]);
        expect(option.innerHTML).toBe(
          renderToStaticMarkup(<Icon name={key} size={18} />),
        );
      }
      fireEvent.click(button(ICON_LABELS.hand));
      expect(button(ICON_LABELS.hand).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(preview()).toBe("hand");
      fireEvent.click(button("Отмена"));
      expect(preview()).toBe("leaf");
      expect(api.save).not.toHaveBeenCalled();

      fireEvent.click(button("Редактировать блок"));
      fireEvent.click(button(ICON_LABELS.hand));
      expect(button(ICON_LABELS.leaf).getAttribute("aria-pressed")).toBe(
        "false",
      );
      fireEvent.click(button("Применить"));
      expect(preview()).toBe("hand");
      fireEvent.click(button("Сохранить черновик"));
      expect(api.save.mock.lastCall?.[0]).toMatchObject({
        blocks: [
          {
            data: {
              [type === "cover" ? "features" : "cards"]: [{ icon: "hand" }],
            },
          },
        ],
      });
    },
  );

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

  it("warns before starting account switching and prompts only once for logout", async () => {
    openEditor();
    fireEvent.click(button("Скрыть блок"));
    vi.mocked(window.confirm)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    fireEvent.click(
      screen.getByRole("link", { name: "Войти в другой аккаунт" }),
    );
    fireEvent.click(button("Выйти"));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Страница входа")).toBeNull();

    fireEvent.click(button("Выйти"));
    expect(await screen.findByText("Страница входа")).toBeTruthy();
    expect(window.confirm).toHaveBeenCalledTimes(3);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AdminLayout } from "@/components/AdminLayout";
import { trpc } from "@/providers/trpc";
import { DEFAULT_DESIGN } from "@contracts/design";
import Design from "./Design";
import Login from "./Login";

const owner = {
  authMethod: "telegram",
  role: "super_admin",
  telegramId: 100,
  displayName: "Владелец",
  photoUrl: null,
};

const attempt = { id: 999, hash: "a".repeat(64), auth_date: 1234567890 };

function openPage({
  base = "/admin",
  path = "/",
  authenticated = true,
  backgroundEnabled = true,
  onBeforeLogout,
}: {
  base?: string;
  path?: string;
  authenticated?: boolean;
  backgroundEnabled?: boolean;
  onBeforeLogout?: () => boolean;
} = {}) {
  let currentUser = authenticated ? owner : null;
  let enabled = backgroundEnabled;
  const requestLogout = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const verify = vi.fn<(input: unknown) => Promise<void>>();
  const client = trpc.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            async function respond() {
              switch (op.path) {
                case "auth.me":
                  return currentUser;
                case "auth.logout":
                  await requestLogout();
                  currentUser = null;
                  return { success: true };
                case "auth.telegram.widgetConfig":
                  return { botName: "test_bot" };
                case "adminAppearance.loginBackground":
                  return { enabled };
                case "adminAppearance.setLoginBackground":
                  enabled = (op.input as { enabled: boolean }).enabled;
                  return { enabled };
                case "content.get":
                  return { design: DEFAULT_DESIGN };
                case "auth.telegram.verify":
                  await verify(op.input);
                  return { success: true };
                case "orders.newCount":
                  return 0;
                default:
                  throw new Error(`Unexpected API call: ${op.path}`);
              }
            }
            void respond().then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error: unknown) => {
                observer.error(
                  new TRPCClientError(
                    error instanceof Error ? error.message : String(error),
                  ),
                );
              },
            );
          }),
    ],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AdminLayout title="Дашборд" onBeforeLogout={onBeforeLogout}>
            <p>Данные панели</p>
          </AdminLayout>
        ),
      },
      { path: "/login", element: <Login /> },
      { path: "/design", element: <Design /> },
    ],
    { basename: base || "/", initialEntries: [base + path] },
  );
  const { container } = render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  return {
    queryClient,
    router,
    requestLogout,
    verify,
    video: () => container.querySelector("video"),
    widget: () => container.querySelector("script[data-telegram-login]"),
  };
}

afterEach(cleanup);

it("saves both background modes from the admin design page", async () => {
  openPage({ path: "/design" });
  const user = userEvent.setup();
  await screen.findByText("Фон страницы входа", {}, { timeout: 3000 });
  const toggle = await screen.findByRole<HTMLInputElement>(
    "checkbox",
    { name: "Анимированный фон" },
    { timeout: 3000 },
  );

  expect(toggle.checked).toBe(true);
  await user.click(toggle);
  await waitFor(() => {
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
  });

  await user.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(true));
});

it.each([true, false])(
  "uses the saved background preference (%s) for visitors of the login page",
  async (backgroundEnabled) => {
    const { queryClient, video, widget } = openPage({
      path: "/login",
      authenticated: false,
      backgroundEnabled,
    });

    expect(video()).toBeNull();
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(video()).toBeNull();
    act(() => widget()?.dispatchEvent(new Event("load")));
    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          getQueryKey(trpc.adminAppearance.loginBackground, undefined, "query"),
        ),
      ).toEqual({ enabled: backgroundEnabled });
      expect(Boolean(video())).toBe(backgroundEnabled);
    });
  },
);

it.each(["/admin", ""])(
  "waits for logout, clears protected queries and replaces the route with %s/login",
  async (base) => {
    const { queryClient, router, requestLogout, widget } = openPage({ base });
    const button = await screen.findByRole("button", { name: "Выйти" });
    const protectedKey = [["orders", "list"]];
    queryClient.setQueryData(protectedKey, ["private"]);
    let finishLogout = () => {};
    requestLogout.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve;
        }),
    );

    const user = userEvent.setup();
    await user.click(button);
    const busy = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Выход…",
    });
    expect(busy.disabled).toBe(true);
    await user.click(busy);
    expect(requestLogout).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe(base + "/");
    expect(queryClient.getQueryData(protectedKey)).toEqual(["private"]);

    await act(async () => finishLogout());
    expect(router.state.location.pathname).toBe(base + "/login");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(queryClient.getQueryData(protectedKey)).toBeUndefined();
    expect(screen.queryByText("Данные панели")).toBeNull();
    await waitFor(() => expect(widget()).not.toBeNull());
  },
);

it("checks the editor guard and keeps the session and cache on a logout error", async () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const { queryClient, router, requestLogout } = openPage({
    onBeforeLogout: confirm,
  });
  const button = await screen.findByRole("button", { name: "Выйти" });
  const protectedKey = [["orders", "list"]];
  queryClient.setQueryData(protectedKey, ["private"]);
  requestLogout.mockRejectedValueOnce(new Error("Unavailable"));
  const user = userEvent.setup();

  await user.click(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(requestLogout).not.toHaveBeenCalled();
  await user.click(button);
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /Не удалось завершить сеанс/,
  );
  expect(router.state.location.pathname).toBe("/admin/");
  expect(queryClient.getQueryData(protectedKey)).toEqual(["private"]);
  expect(screen.getByText("Данные панели")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Выйти" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/admin/login"),
  );
});

it("shows the current account before switching and uses the Telegram widget after logout", async () => {
  const { router, requestLogout, verify, widget } = openPage();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("link", { name: "Войти в другой аккаунт" }),
  );
  expect(router.state.location.search).toBe("?switch=1");
  expect(screen.getByText("Текущий аккаунт")).toBeTruthy();
  expect(screen.getByText("Владелец")).toBeTruthy();
  expect(screen.getByText("Telegram ID 100 · super_admin")).toBeTruthy();
  expect(widget()).toBeNull();
  expect(requestLogout).not.toHaveBeenCalled();

  await user.click(
    screen.getByRole("button", { name: "Войти в другой аккаунт" }),
  );
  await waitFor(() => expect(widget()).not.toBeNull());
  expect(requestLogout).toHaveBeenCalledTimes(1);
  expect(router.state.location.search).toBe("?switch=1");
  expect(screen.queryByText("Владелец")).toBeNull();
  expect(screen.getByText(/переключите аккаунт в Telegram/)).toBeTruthy();

  verify.mockRejectedValueOnce(new Error("Доступ запрещён"));
  act(() => window.onTelegramAuth?.(attempt));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Доступ запрещён",
  );
  expect(verify).toHaveBeenCalledWith(attempt);
  expect(router.state.location.pathname).toBe("/admin/login");
});

it("keeps the normal login redirect for an authenticated user", async () => {
  const { router, widget } = openPage({ path: "/login" });
  expect(await screen.findByText("Данные панели")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/admin");
  expect(widget()).toBeNull();
});

it("toggles the contact links with the keyboard and updates their accessibility", async () => {
  openPage({ path: "/login", authenticated: false });
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: "Контакты разработчика" });
  const panel = document.getElementById(button.getAttribute("aria-controls")!);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(panel?.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("link", { name: "GitHub" })).toBeNull();
  button.focus();
  await user.keyboard("{Enter}");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(panel?.hasAttribute("inert")).toBe(false);
  expect(
    screen.getByRole("link", { name: "GitHub" }).getAttribute("href"),
  ).toBe("https://github.com/UnicornisIT");
  await user.keyboard(" ");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("link", { name: "GitHub" })).toBeNull();
});

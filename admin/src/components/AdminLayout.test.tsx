import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminLayout } from "./AdminLayout";

const { useAuth } = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth,
  switchAccountPath: "/login?switch=1",
  useLogout: () => ({ logout: vi.fn(), isLoggingOut: false, logoutError: "" }),
}));
vi.mock("@/providers/trpc", () => ({
  trpc: { orders: { newCount: { useQuery: () => ({ data: 3 }) } } },
}));
vi.mock("./UpdateNotificationCenter", () => ({
  UpdateNotificationCenter: () => null,
}));

let desktop: boolean;
let mediaChanges: EventTarget;

beforeEach(() => {
  desktop = false;
  mediaChanges = new EventTarget();
  vi.stubGlobal("matchMedia", () => ({
    matches: desktop,
    addEventListener: mediaChanges.addEventListener.bind(mediaChanges),
    removeEventListener: mediaChanges.removeEventListener.bind(mediaChanges),
  }));
  useAuth.mockReturnValue({
    isAdmin: true,
    isSuperAdmin: false,
    isLoading: false,
    user: { displayName: "Мария", role: "admin" },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setDesktop(value: boolean) {
  act(() => {
    desktop = value;
    mediaChanges.dispatchEvent(new Event("change"));
  });
}

function Page() {
  const { pathname } = useLocation();
  return <AdminLayout title="Раздел">{pathname}</AdminLayout>;
}

function renderPage() {
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
  return screen.getByRole("button", { name: "Открыть меню" });
}

it("opens a labelled menu, locks the workspace and restores focus after Escape", async () => {
  const trigger = renderPage();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("navigation")).toBeNull();

  fireEvent.click(trigger);
  const drawer = screen.getByRole("dialog", { name: "Панель администратора" });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(
    within(drawer).getByRole("button", { name: "Закрыть меню" }),
  );
  expect(
    document.querySelector("main")?.classList.contains("overflow-hidden"),
  ).toBe(true);
  expect(
    within(drawer)
      .getByRole("link", { name: "Дашборд" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    within(drawer).getByRole("status", { name: "3 новых заказов" }),
  ).toBeTruthy();
  expect(within(drawer).getByText("Мария")).toBeTruthy();
  expect(within(drawer).queryByRole("link", { name: "Доступ" })).toBeNull();

  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("main").classList.contains("overflow-hidden")).toBe(
    false,
  );
});

it("closes after navigation and switches to a single desktop menu when resized", () => {
  useAuth.mockReturnValue({
    isAdmin: true,
    isSuperAdmin: true,
    isLoading: false,
  });
  const trigger = renderPage();
  fireEvent.click(trigger);
  expect(screen.getByRole("link", { name: "Доступ" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Обновление сервера" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Коллекции" }));
  expect(screen.getByRole("main").textContent).toBe("/collections");
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(trigger);
  setDesktop(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("navigation")).toHaveLength(1);
  expect(
    screen
      .getByRole("link", { name: "Коллекции" })
      .getAttribute("aria-current"),
  ).toBe("page");
  setDesktop(false);
  expect(
    screen
      .getByRole("button", { name: "Открыть меню" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.queryByRole("navigation")).toBeNull();
});

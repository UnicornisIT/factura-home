import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Orders from "./Orders";

const { useOrders } = vi.hoisted(() => ({ useOrders: vi.fn() }));

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/OrderTelegramSettings", () => ({
  OrderTelegramSettings: () => null,
}));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    orders: {
      list: { useQuery: useOrders },
      updateStatus: { useMutation: () => ({}) },
      delete: { useMutation: () => ({}) },
    },
  },
}));

const order = {
  id: 1,
  name: "Иван",
  status: "new",
  createdAt: new Date(0),
  total: 700,
  items: '[{"name":"Ваза","price":700,"qty":1}]',
};

afterEach(cleanup);

it("shows structured contacts with the appropriate links and one preferred contact", () => {
  useOrders.mockReturnValue({
    data: [
      {
        ...order,
        contact: "ivan+order@example.ru",
        contactDetails: {
          telegram: "ivanov",
          phone: "+12025550123",
          email: "ivan+order@example.ru",
          preferred: "email",
        },
      },
    ],
  });
  render(<Orders />);
  fireEvent.click(screen.getByRole("button", { name: /#1 · Иван/ }));
  const contacts = within(
    screen.getByRole("region", { name: "Способы связи" }),
  );
  expect(
    contacts.getByRole("link", { name: "@ivanov" }).getAttribute("href"),
  ).toBe("https://t.me/ivanov");
  expect(
    contacts
      .getByRole("link", { name: "+1 202 555 0123" })
      .getAttribute("href"),
  ).toBe("tel:+12025550123");
  const email = contacts.getByRole("link", { name: "ivan+order@example.ru" });
  expect(email.getAttribute("href")).toBe("mailto:ivan%2Border@example.ru");
  expect(
    contacts.getByText("Предпочтительный").closest("dd")?.parentElement,
  ).toBe(email.closest("dd")?.parentElement);
});

it.each([
  ["@ivan", "https://t.me/ivan"],
  ["ivan@example.ru", "mailto:ivan@example.ru"],
  ["@../../share?url=unsafe", undefined],
] as const)("renders legacy contact %s safely", (contact, href) => {
  useOrders.mockReturnValue({
    data: [{ ...order, contact, contactDetails: null }],
  });
  render(<Orders />);
  fireEvent.click(screen.getByRole("button", { name: /#1 · Иван/ }));
  expect(screen.getByText(contact).closest("a")?.getAttribute("href")).toBe(
    href,
  );
});

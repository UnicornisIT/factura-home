import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StorefrontPreview } from "./StorefrontPreview";

it("changes the iframe width limit without reloading the storefront", () => {
  const onCollapse = vi.fn();
  const { rerender } = render(
    <StorefrontPreview
      blocks={[]}
      version={1}
      expanded={false}
      onCollapse={onCollapse}
    />,
  );
  const frame = screen.getByTitle("Предпросмотр витрины") as HTMLIFrameElement;

  for (const [device, width] of [
    ["Компьютер", "1440px"],
    ["Планшет", "768px"],
    ["Смартфон", "390px"],
  ]) {
    const button = screen.getByRole("button", { name: device });
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(frame.style.maxWidth).toBe(width);
    expect(screen.getByTitle("Предпросмотр витрины")).toBe(frame);
  }

  rerender(
    <StorefrontPreview
      blocks={[]}
      version={1}
      expanded
      onCollapse={onCollapse}
    />,
  );
  expect(screen.getByTitle("Предпросмотр витрины")).toBe(frame);
  expect(frame.style.maxWidth).toBe("390px");
  fireEvent.click(
    screen.getByRole("button", { name: "Вернуться к редактору" }),
  );
  expect(onCollapse).toHaveBeenCalledOnce();
});

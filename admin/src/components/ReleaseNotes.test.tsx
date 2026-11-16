import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";

afterEach(cleanup);

it("renders GitHub Markdown and hides technical notes from current and older releases", () => {
  render(
    <ReleaseNotes
      notes={[
        "### Добавлено",
        "",
        "- **Редактор** со встроенным [предпросмотром](https://example.com/editor).",
        "- При обновлении применяется миграция `007_home_page_draft`.",
        "- Исправлены замечания ShellCheck в скрипте обновления.",
        "",
        "### Технические изменения",
        "",
        "#### Развёртывание",
        "",
        "- Изменились настройки сервера.",
        "",
        "### Изменено",
        "",
        "| Раздел | Изменение |",
        "| --- | --- |",
        "| Каталог | ~~Старый фильтр~~ |",
      ].join("\n")}
    />,
  );

  const notes = within(screen.getByRole("region", { name: "Что нового" }));
  expect(notes.getByRole("heading", { name: "Добавлено" }).tagName).toBe("H3");
  expect(notes.getByText("Редактор").tagName).toBe("STRONG");
  expect(
    notes.getByRole("link", { name: "предпросмотром" }).getAttribute("href"),
  ).toBe("https://example.com/editor");
  expect(notes.getAllByRole("listitem")).toHaveLength(1);
  expect(notes.getByRole("table")).toBeTruthy();
  expect(notes.getByText("Старый фильтр").tagName).toBe("DEL");
  expect(
    notes.queryByText(/007_home_page_draft|ShellCheck|Изменились настройки/),
  ).toBeNull();
  expect(
    notes.queryByRole("heading", {
      name: /Технические изменения|Развёртывание/,
    }),
  ).toBeNull();
});

it("ignores raw HTML and unsafe URLs in release notes", () => {
  const { container } = render(
    <ReleaseNotes
      notes={
        "<script>alert(1)</script>\n\n[Ссылка](javascript:alert%281%29)\n\n[Справка](https://example.com)"
      }
    />,
  );

  expect(container.querySelector("script, a[href^='javascript:']")).toBeNull();
  expect(screen.queryByText("alert(1)")).toBeNull();
  expect(screen.getByRole("link", { name: "Справка" })).toBeTruthy();
});

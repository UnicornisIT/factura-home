import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ImageUpload } from "./ImageUpload";

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function pngFile(name = "photo.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, {
    type: "image/png",
  });
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

async function selectFile(file: File) {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Выбрать изображение"), file);
}

function uploadButton() {
  return screen.getByRole("button") as HTMLButtonElement;
}

describe("ImageUpload", () => {
  it("загружает файл, передаёт URL и возвращает кнопку в исходное состояние", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { url: "/uploads/abc.webp" }),
    );
    const onUpload = vi.fn();
    const onBusyChange = vi.fn();
    render(<ImageUpload onUpload={onUpload} onBusyChange={onBusyChange} />);

    await selectFile(pngFile());

    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith("/uploads/abc.webp"),
    );
    expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(uploadButton().disabled).toBe(false);
    expect(uploadButton().textContent).toBe("Загрузить фото");
  });

  it("блокирует кнопку и повторный выбор файла во время загрузки", async () => {
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<ImageUpload onUpload={vi.fn()} />);

    await selectFile(pngFile());

    expect(uploadButton().disabled).toBe(true);
    expect(uploadButton().textContent).toBe("Загрузка…");
    // Повторная попытка во время активной загрузки игнорируется.
    await selectFile(pngFile("second.png"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse(200, { url: "/uploads/abc.webp" }));
    await waitFor(() => expect(uploadButton().disabled).toBe(false));
  });

  it("прерывает зависший запрос по тайм-ауту и восстанавливает кнопку", async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    render(<ImageUpload onUpload={vi.fn()} timeoutMs={50} />);

    await selectFile(pngFile());

    await waitFor(
      () =>
        expect(screen.getByRole("alert").textContent).toContain(
          "заняла слишком много времени",
        ),
      { timeout: 3000 },
    );
    expect(uploadButton().disabled).toBe(false);
    expect(uploadButton().textContent).toBe("Загрузить фото");
  });

  it("показывает безопасное сообщение сервера при ошибке и позволяет повторить", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: "Не удалось сохранить файл на сервере" }),
    );
    const onUpload = vi.fn();
    render(<ImageUpload onUpload={onUpload} />);

    await selectFile(pngFile());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Не удалось сохранить файл на сервере",
      ),
    );
    expect(onUpload).not.toHaveBeenCalled();
    expect(uploadButton().disabled).toBe(false);

    // Повторная попытка без перезагрузки страницы завершается успешно.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { url: "/uploads/retry.webp" }),
    );
    await selectFile(pngFile());
    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith("/uploads/retry.webp"),
    );
  });

  it("сообщает о сетевой ошибке", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ImageUpload onUpload={vi.fn()} />);

    await selectFile(pngFile());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Не удалось связаться с сервером",
      ),
    );
    expect(uploadButton().disabled).toBe(false);
  });

  it("не считает загрузку успешной при некорректной структуре ответа", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { url: 42 }));
    const onUpload = vi.fn();
    render(<ImageUpload onUpload={onUpload} />);

    await selectFile(pngFile());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "некорректный ответ",
      ),
    );
    expect(onUpload).not.toHaveBeenCalled();
    expect(uploadButton().disabled).toBe(false);
  });

  it("отклоняет файл больше 5 МБ без обращения к серверу", async () => {
    render(<ImageUpload onUpload={vi.fn()} />);
    const oversize = new File([new Uint8Array(8)], "big.png", {
      type: "image/png",
    });
    Object.defineProperty(oversize, "size", { value: 6 * 1024 * 1024 });

    await selectFile(oversize);

    expect(screen.getByRole("alert").textContent).toContain(
      "Максимальный размер — 5 МБ",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("обновляет поле ссылки на обложку так же, как форма коллекции", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { url: "/uploads/cover.webp" }),
    );

    function CoverForm() {
      const [coverImage, setCoverImage] = useState("");
      return (
        <div>
          <input
            aria-label="Ссылка на обложку"
            value={coverImage}
            onChange={(event) => setCoverImage(event.target.value)}
          />
          <ImageUpload onUpload={(url) => setCoverImage(url)} />
        </div>
      );
    }

    render(<CoverForm />);
    await selectFile(pngFile());

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Ссылка на обложку") as HTMLInputElement).value,
      ).toBe("/uploads/cover.webp"),
    );
  });
});

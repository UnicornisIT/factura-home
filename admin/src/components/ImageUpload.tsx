import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TIMEOUT_MS = 60_000;

type ImageUploadProps = {
  onUpload: (url: string) => void;
  /** Позволяет форме заблокировать сохранение, пока загрузка не завершена. */
  onBusyChange?: (busy: boolean) => void;
  /** Тайм-аут запроса; в тестах передаётся меньшее значение. */
  timeoutMs?: number;
};

function describeHttpStatus(status: number): string {
  if (status === 401) return "Сессия истекла — войдите в панель заново.";
  if (status === 403) return "Недостаточно прав для загрузки изображений.";
  if (status === 413)
    return "Файл слишком большой. Максимальный размер — 5 МБ.";
  if (status === 429) return "Слишком много запросов. Повторите попытку позже.";
  if (status >= 500)
    return "Сервер не смог обработать загрузку. Повторите попытку позже.";
  return "Не удалось загрузить изображение. Проверьте формат файла и доступ к панели.";
}

/** Текст ошибки от сервера показываем, только если это короткая безопасная строка. */
function safeServerMessage(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : "";
}

export function ImageUpload({
  onUpload,
  onBusyChange,
  timeoutMs = UPLOAD_TIMEOUT_MS,
}: ImageUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Ссылки, а не state: защита от гонки и от обновления состояния после
  // размонтирования компонента.
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const applyBusy = (value: boolean) => {
    busyRef.current = value;
    if (mountedRef.current) setBusy(value);
    onBusyChange?.(value);
  };

  const upload = async (file: File) => {
    // Одна загрузка за раз: повторный выбор файла во время активной игнорируем.
    if (busyRef.current) return;
    if (mountedRef.current) setError("");
    if (file.size > MAX_SIZE_BYTES) {
      if (mountedRef.current) setError("Максимальный размер — 5 МБ");
      return;
    }

    applyBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        body: data,
      });
      if (!response.ok) {
        let detail = "";
        try {
          const payload = (await response.json()) as { error?: unknown };
          detail = safeServerMessage(payload.error);
        } catch {
          // Тело не JSON (например, HTML от прокси) — используем статус.
        }
        throw new Error(detail || describeHttpStatus(response.status));
      }
      const result = (await response.json().catch(() => null)) as {
        url?: unknown;
      } | null;
      // Загрузка успешна только при корректной структуре ответа.
      if (
        !result ||
        typeof result.url !== "string" ||
        !result.url.startsWith("/")
      ) {
        throw new Error("Сервер вернул некорректный ответ. Повторите попытку.");
      }
      onUpload(result.url);
    } catch (caught) {
      if (!mountedRef.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError(
          "Загрузка заняла слишком много времени и была прервана. Повторите попытку или выберите файл меньшего размера.",
        );
      } else if (caught instanceof TypeError) {
        // Сетевая ошибка fetch (нет связи, обрыв соединения, сбой прокси).
        setError(
          "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.",
        );
      } else {
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : "Ошибка загрузки. Повторите попытку.",
        );
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      applyBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Выбрать изображение"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void upload(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Загрузка…" : "Загрузить фото"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

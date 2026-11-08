import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export function ImageUpload({ onUpload }: { onUpload: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="mt-2 space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Выбрать изображение"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError("");
          if (file.size > 5 * 1024 * 1024) {
            setError("Максимальный размер — 5 МБ");
            return;
          }
          setBusy(true);
          try {
            const data = new FormData();
            data.append("file", file);
            const response = await fetch("/api/upload", {
              method: "POST",
              credentials: "same-origin",
              body: data,
            });
            if (!response.ok)
              throw new Error(
                "Не удалось загрузить изображение. Проверьте формат файла и доступ к панели.",
              );
            const result = (await response.json()) as { url: string };
            onUpload(result.url);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "Ошибка загрузки",
            );
          } finally {
            setBusy(false);
          }
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

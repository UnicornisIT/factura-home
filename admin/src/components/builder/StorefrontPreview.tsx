import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { Block } from "@contracts/blocks";
import { Button } from "@/components/ui/button";

const SHOP_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : window.location.origin;
const devices = [
  { key: "desktop", label: "Компьютер", icon: Monitor, width: 1440 },
  { key: "tablet", label: "Планшет", icon: Tablet, width: 768 },
  { key: "mobile", label: "Смартфон", icon: Smartphone, width: 390 },
] as const;

export function StorefrontPreview({
  blocks,
  version,
  expanded,
  onCollapse,
}: {
  blocks: Block[];
  version: number;
  expanded: boolean;
  onCollapse: () => void;
}) {
  const [device, setDevice] = useState<(typeof devices)[number]>(() =>
    window.matchMedia?.("(max-width: 639px)").matches ? devices[2] : devices[0],
  );
  const [published, setPublished] = useState(false);
  const [ready, setReady] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const frameArea = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const scale = frameWidth ? Math.min(1, frameWidth / device.width) : 1;

  useEffect(() => {
    const area = frameArea.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setFrameWidth(entry.contentRect.width);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === SHOP_ORIGIN &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "home-preview-ready"
      )
        setReady((value) => value + 1);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (ready && !published)
      frame.current?.contentWindow?.postMessage(
        { type: "home-preview-blocks", blocks },
        SHOP_ORIGIN,
      );
  }, [blocks, published, ready]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded, onCollapse]);

  return (
    <section
      aria-label="Предпросмотр главной страницы"
      className={
        expanded
          ? "admin-preview-expanded fixed inset-0 z-40 flex flex-col overflow-y-auto bg-white"
          : "min-w-0 rounded-lg border bg-white p-3"
      }
    >
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Размер экрана"
        >
          {devices.map((item) => (
            <Button
              key={item.key}
              size="icon"
              variant={device.key === item.key ? "default" : "outline"}
              aria-label={item.label}
              title={item.label}
              aria-pressed={device.key === item.key}
              onClick={() => setDevice(item)}
            >
              <item.icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1 [&>button]:h-auto [&>button]:min-h-8 [&>button]:max-w-full [&>button]:whitespace-normal">
          <Button
            size="sm"
            variant={published ? "outline" : "default"}
            aria-pressed={!published}
            onClick={() => {
              if (published) setReady(0);
              setPublished(false);
            }}
          >
            Черновик
          </Button>
          <Button
            size="sm"
            variant={published ? "default" : "outline"}
            aria-pressed={published}
            onClick={() => setPublished(true)}
          >
            Опубликованная версия
          </Button>
          {expanded && (
            <Button size="sm" variant="outline" onClick={onCollapse}>
              Вернуться к редактору
            </Button>
          )}
        </div>
      </div>
      <div
        ref={frameArea}
        className={`relative flex min-w-0 justify-center overflow-hidden rounded-md bg-slate-100 ${expanded ? "min-h-32 flex-1" : "h-[68dvh]"}`}
      >
        <iframe
          ref={frame}
          key={published ? `published-${version}` : "draft"}
          src={`${SHOP_ORIGIN}/editor-preview${published ? "/published" : ""}`}
          sandbox="allow-scripts allow-same-origin"
          title="Предпросмотр витрины"
          className="absolute top-0 block h-full w-full origin-top rounded-md bg-white"
          style={{
            maxWidth: device.width,
            ...(scale < 1 && {
              width: device.width,
              height: `${100 / scale}%`,
              transform: `scale(${scale})`,
            }),
          }}
        />
      </div>
    </section>
  );
}

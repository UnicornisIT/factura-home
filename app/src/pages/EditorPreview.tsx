import { useEffect, useState } from "react";
import type { Block } from "@contracts/blocks";
import { trpc } from "@/providers/trpc";
import Home from "./Home";

export default function EditorPreview({
  published = false,
}: {
  published?: boolean;
}) {
  const draft = trpc.blocks.draft.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 30000,
  });
  const live = trpc.blocks.list.useQuery(undefined, { enabled: published });
  const [localBlocks, setLocalBlocks] = useState<Block[]>();
  const canReceive = draft.isSuccess && !published;

  useEffect(() => {
    if (!canReceive || window.parent === window) return;
    const parentOrigin = import.meta.env.DEV
      ? "http://localhost:3001"
      : window.location.origin;
    const receive = (event: MessageEvent) => {
      if (
        event.origin === parentOrigin &&
        event.source === window.parent &&
        event.data?.type === "home-preview-blocks" &&
        Array.isArray(event.data.blocks)
      )
        setLocalBlocks(event.data.blocks);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "home-preview-ready" }, parentOrigin);
    return () => window.removeEventListener("message", receive);
  }, [canReceive]);

  if (draft.isError)
    return (
      <p role="alert">Для предпросмотра требуется доступ администратора.</p>
    );
  if (published && live.isError)
    return <p role="alert">Не удалось загрузить опубликованную версию.</p>;

  const blocks = published ? live.data : (localBlocks ?? draft.data?.blocks);
  if (!draft.isSuccess || !blocks) return <p role="status">Загрузка…</p>;

  return (
    <>
      <div className="storefront-preview-banner">
        {published
          ? "Предпросмотр — опубликованная версия"
          : "Предпросмотр — неопубликованная версия"}
      </div>
      <Home previewBlocks={blocks} />
    </>
  );
}

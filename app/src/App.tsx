import { useEffect } from "react";
import { Routes, Route } from "react-router";
import { DEFAULT_FAVICON_URL } from "@contracts/design";
import { trpc } from "./providers/trpc";
import Home from "./pages/Home";
import EditorPreview from "./pages/EditorPreview";
import NotFound from "./pages/NotFound";

export default function App() {
  const { data: content } = trpc.content.get.useQuery();
  const favicon = content?.design.faviconImage || DEFAULT_FAVICON_URL;

  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    icon?.setAttribute("href", favicon);
  }, [favicon]);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/editor-preview" element={<EditorPreview />} />
      <Route
        path="/editor-preview/published"
        element={<EditorPreview published />}
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

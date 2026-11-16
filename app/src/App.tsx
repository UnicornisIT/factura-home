import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import EditorPreview from "./pages/EditorPreview";
import NotFound from "./pages/NotFound";

export default function App() {
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

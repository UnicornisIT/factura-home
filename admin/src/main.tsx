import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import App from "./App";
import { TRPCProvider } from "@/providers/trpc";

// В проде админка живёт на /admin/* (см. admin/vite.config.ts: base="/admin/").
// BrowserRouter нужно явно сказать про basename, иначе она будет думать,
// что живёт в корне домена, и ломать ссылки.
const basename = import.meta.env.BASE_URL; // "/admin/" в проде, "/" в dev (порт 3001)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
);

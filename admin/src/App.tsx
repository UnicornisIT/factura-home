import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Routes, Route } from "react-router";
import { DEFAULT_FAVICON_URL } from "@contracts/design";
import { useAuth } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import { trpc } from "@/providers/trpc";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Products = lazy(() => import("@/pages/Products"));
const Collections = lazy(() => import("@/pages/Collections"));
const Builder = lazy(() => import("@/pages/Builder"));
const Orders = lazy(() => import("@/pages/Orders"));
const Content = lazy(() => import("@/pages/Content"));
const Design = lazy(() => import("@/pages/Design"));
const Access = lazy(() => import("@/pages/Access"));
const ServerUpdate = lazy(() => import("@/pages/ServerUpdate"));

function PageLoading() {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center text-sm text-slate-500"
    >
      Загрузка…
    </div>
  );
}

function AdminRoutes() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <PageLoading />;
  return isAdmin ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  const { data: content } = trpc.content.get.useQuery();
  const favicon = content?.design.faviconImage || DEFAULT_FAVICON_URL;

  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    icon?.setAttribute("href", favicon);
  }, [favicon]);

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<AdminRoutes />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/content" element={<Content />} />
          <Route path="/design" element={<Design />} />
          <Route
            path="/preview"
            element={<Navigate to="/builder?preview=1" replace />}
          />
          <Route path="/access" element={<Access />} />
          <Route path="/server-update" element={<ServerUpdate />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

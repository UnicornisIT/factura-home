import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "react-router";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

const desktopWidth = 1024;
const desktopQuery = `(min-width: ${desktopWidth}px)`;

function subscribeToDesktop(onChange: () => void) {
  const media = window.matchMedia?.(desktopQuery);
  if (media?.addEventListener) {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function isDesktopViewport() {
  return (
    window.matchMedia?.(desktopQuery).matches ??
    window.innerWidth >= desktopWidth
  );
}

interface AdminLayoutProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  onBeforeLogout?: () => boolean;
  children: ReactNode;
  /**
   * Минимальная роль для доступа к странице. По умолчанию "admin".
   * Для управления allowlist указать "super_admin".
   */
  requireRole?: "admin" | "super_admin";
}

export function AdminLayout({
  title,
  description,
  actions,
  onBeforeLogout,
  children,
  requireRole = "admin",
}: AdminLayoutProps) {
  const { isAdmin, isSuperAdmin, isLoading } = useAuth();
  const desktop = useSyncExternalStore(subscribeToDesktop, isDesktopViewport);
  const [menuOpen, setMenuOpen] = useState(false);

  if (desktop && menuOpen) setMenuOpen(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Загрузка…
      </div>
    );
  }

  // Не админ → на логин.
  if (!isAdmin) return <Navigate to="/login" replace />;

  // Страница требует super_admin, поэтому обычный администратор попадёт на дашборд.
  if (requireRole === "super_admin" && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  const sidebar = (
    <Sidebar
      mobile={!desktop}
      onNavigate={() => setMenuOpen(false)}
      onBeforeLogout={onBeforeLogout}
    />
  );

  return (
    <Dialog open={!desktop && menuOpen} onOpenChange={setMenuOpen}>
      <div className="admin-shell flex overflow-hidden bg-canvas">
        {sidebar}
        <div className="flex flex-col flex-1 min-w-0">
          <Header
            title={title}
            description={description}
            actions={actions}
            superAdmin={isSuperAdmin}
            navigation={
              !desktop && (
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label="Открыть меню"
                  >
                    <Menu aria-hidden="true" />
                  </Button>
                </DialogTrigger>
              )
            }
          />
          <main
            className={`admin-main min-h-0 flex-1 overscroll-contain [overflow-wrap:anywhere] ${menuOpen ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden"}`}
          >
            {children}
          </main>
        </div>
      </div>
    </Dialog>
  );
}

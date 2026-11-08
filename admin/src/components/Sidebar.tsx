import { trpc } from "@/providers/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavLink } from "react-router";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingCart,
  FileText,
  LogOut,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const NAV_BASE = [
  { to: "/", label: "Дэшборд", icon: LayoutDashboard, end: true },
  { to: "/products", label: "Товары", icon: Package },
  { to: "/collections", label: "Коллекции", icon: FolderTree },
  { to: "/orders", label: "Заказы", icon: ShoppingCart },
  { to: "/content", label: "Тексты и контакты", icon: FileText },
];

export function Sidebar() {
  const { user, logout, isSuperAdmin } = useAuth();
  const { data: newOrders } = trpc.orders.newCount.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });

  // Только super_admin видит страницу "Доступ" (управление allowlist).
  const nav = isSuperAdmin
    ? [
        ...NAV_BASE,
        { to: "/access", label: "Доступ", icon: ShieldCheck, end: false },
      ]
    : NAV_BASE;

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-sidebar text-slate-100 border-r border-sidebar-border">
      {/* Лого */}
      <div className="px-4 py-5 border-b border-sidebar-border">
        <div className="font-semibold text-base leading-tight">Глиняная</div>
        <div className="font-semibold text-base leading-tight">мастерская</div>
        <div className="text-[10px] uppercase tracking-wider text-sidebar-muted mt-1">
          Админ-панель
        </div>
      </div>

      {/* Навигация */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-active text-white"
                    : "text-slate-300 hover:bg-sidebar-hover hover:text-white",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {item.to === "/orders" && !!newOrders && (
                <Badge
                  variant="warning"
                  className="ml-auto"
                  role="status"
                  aria-live="polite"
                  aria-label={`${newOrders} новых заказов`}
                >
                  {newOrders}
                </Badge>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Футер сайдбара: пользователь и выход */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <a
          href="/"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors px-2 py-1"
          title="Открыть магазин в новой вкладке"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Открыть магазин
        </a>
        <div className="flex items-center justify-between gap-2 bg-sidebar-hover rounded-md px-2 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {user?.photoUrl ? (
              <img
                src={user.photoUrl}
                alt=""
                className="h-7 w-7 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-7 w-7 rounded-full bg-[#5C2A2A] flex items-center justify-center text-xs font-semibold text-white shrink-0">
                {(user?.displayName ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-medium text-white truncate">
                {user?.displayName ?? "—"}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {user?.role === "super_admin"
                  ? "super_admin"
                  : user?.role === "admin"
                    ? "admin"
                    : (user?.authMethod ?? "")}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="text-slate-400 hover:text-white hover:bg-sidebar-active"
            title="Выйти"
            aria-label="Выйти"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

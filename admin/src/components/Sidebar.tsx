import { trpc } from "@/providers/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Content as DialogPanel } from "@radix-ui/react-dialog";
import { Link, NavLink } from "react-router";
import type { MouseEvent } from "react";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  LayoutTemplate,
  ShoppingCart,
  FileText,
  LoaderCircle,
  LogOut,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Palette,
  X,
} from "lucide-react";
import { switchAccountPath, useAuth, useLogout } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const NAV_BASE = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
  { to: "/orders", label: "Заказы", icon: ShoppingCart },
  { to: "/products", label: "Товары", icon: Package },
  { to: "/collections", label: "Коллекции", icon: FolderTree },
  { to: "/builder", label: "Редактор главной страницы", icon: LayoutTemplate },
  { to: "/design", label: "Дизайн сайта", icon: Palette },
  { to: "/content", label: "Тексты и контакты", icon: FileText },
];

export function Sidebar({
  mobile,
  onNavigate,
  onBeforeLogout,
}: {
  mobile: boolean;
  onNavigate: () => void;
  onBeforeLogout?: () => boolean;
}) {
  const { user, isSuperAdmin } = useAuth();
  const { logout, isLoggingOut, logoutError } = useLogout();
  const { data: newOrders } = trpc.orders.newCount.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });

  const nav = isSuperAdmin
    ? [
        ...NAV_BASE,
        { to: "/access", label: "Доступ", icon: ShieldCheck, end: false },
        {
          to: "/server-update",
          label: "Обновление сервера",
          icon: RefreshCw,
          end: false,
        },
      ]
    : NAV_BASE;

  function handleNavigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      mobile &&
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      onNavigate();
    }
  }

  const content = (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4 py-2 lg:py-5">
        {mobile ? (
          <>
            <DialogTitle className="text-base leading-tight">
              Панель администратора
            </DialogTitle>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-slate-300 hover:bg-sidebar-hover hover:text-white"
                aria-label="Закрыть меню"
              >
                <X aria-hidden="true" />
              </Button>
            </DialogClose>
          </>
        ) : (
          <div className="font-semibold text-base leading-tight">
            Панель администратора
          </div>
        )}
      </div>

      <nav
        aria-label="Разделы админки"
        className="py-3 px-2 space-y-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={handleNavigate}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 lg:min-h-0",
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
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to={switchAccountPath} onClick={handleNavigate}>
            Войти в другой аккаунт
          </Link>
        </Button>
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
            type="button"
            variant="ghost"
            size="icon"
            disabled={isLoggingOut}
            aria-busy={isLoggingOut}
            onClick={() => {
              if (!onBeforeLogout || onBeforeLogout()) logout();
            }}
            className="text-slate-400 hover:text-white hover:bg-sidebar-active"
            title={isLoggingOut ? "Выход…" : "Выйти"}
            aria-label={isLoggingOut ? "Выход…" : "Выйти"}
          >
            {isLoggingOut ? (
              <LoaderCircle
                aria-hidden="true"
                className="motion-safe:animate-spin"
              />
            ) : (
              <LogOut aria-hidden="true" />
            )}
          </Button>
        </div>
        {logoutError && (
          <p role="alert" className="px-2 text-xs text-red-200">
            {logoutError}
          </p>
        )}
      </div>
    </>
  );

  if (mobile) {
    return (
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-none motion-reduce:animate-none" />
        <DialogPanel
          aria-describedby={undefined}
          className="admin-drawer fixed inset-y-0 left-0 z-50 flex w-72 max-w-[calc(100%-2rem)] flex-col overflow-y-auto overscroll-contain border-r border-sidebar-border bg-sidebar text-slate-100 shadow-xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left duration-200 motion-reduce:animate-none"
        >
          {content}
        </DialogPanel>
      </DialogPortal>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-slate-100">
      {content}
    </aside>
  );
}

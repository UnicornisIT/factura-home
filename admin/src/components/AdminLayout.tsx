import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AdminLayoutProps {
  title: string;
  description?: string;
  actions?: ReactNode;
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
  children,
  requireRole = "admin",
}: AdminLayoutProps) {
  const { isAdmin, isSuperAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Загрузка…
      </div>
    );
  }

  // Не админ → на логин.
  if (!isAdmin) return <Navigate to="/login" replace />;

  // Требуется super_admin, но юзер обычный админ → на дэшборд.
  if (requireRole === "super_admin" && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Header title={title} description={description} actions={actions} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

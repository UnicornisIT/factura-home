import type { ReactNode } from "react";
import { UpdateNotificationCenter } from "./UpdateNotificationCenter";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  navigation?: ReactNode;
  superAdmin: boolean;
}

export function Header({
  title,
  description,
  actions,
  navigation,
  superAdmin,
}: HeaderProps) {
  return (
    <header className="admin-header flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {navigation}
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <h1 className="text-lg font-semibold leading-tight text-slate-900 sm:text-xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
        <UpdateNotificationCenter superAdmin={superAdmin} />
      </div>
      {actions && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

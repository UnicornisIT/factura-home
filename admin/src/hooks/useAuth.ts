import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { useRef } from "react";
import { useNavigate } from "react-router";

export type AuthUser = {
  authMethod: "telegram";
  role: string;
  telegramId?: number | null;
  displayName?: string | null;
  photoUrl?: string | null;
};

export function useAuth() {
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    staleTime: 0,
    refetchInterval: 30000,
    retry: false,
  });

  return {
    user: (user ?? null) as AuthUser | null,
    isAdmin: user?.role === "admin" || user?.role === "super_admin",
    isSuperAdmin: user?.role === "super_admin",
    isLoading,
  };
}

export const switchAccountPath = "/login?switch=1";

export function useLogout() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const destination = useRef<string | null>(null);
  const { mutate, isPending, isError } = trpc.auth.logout.useMutation({
    onSuccess: () => {
      queryClient.clear();
      utils.auth.me.setData(undefined, null);
      void navigate(destination.current ?? "/login", {
        replace: true,
        state: { loggedOut: true },
      });
    },
    onSettled: () => {
      destination.current = null;
    },
  });

  function logout(path = "/login") {
    if (destination.current) return;
    destination.current = path;
    mutate();
  }

  return {
    logout,
    isLoggingOut: isPending,
    logoutError: isError
      ? "Не удалось завершить сеанс. Попробуйте ещё раз."
      : "",
  };
}

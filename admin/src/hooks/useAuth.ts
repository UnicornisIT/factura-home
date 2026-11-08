import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { useCallback, useMemo } from "react";

export type AuthUser = {
  authMethod: "telegram";
  role: string;
  telegramId?: number | null;
  displayName?: string | null;
  photoUrl?: string | null;
};

export function useAuth() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    staleTime: 0,
    refetchInterval: 30000,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      queryClient.clear();
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(() => logoutMutation.mutate(), [logoutMutation]);

  return useMemo(
    () => ({
      user: (user ?? null) as AuthUser | null,
      isAuthenticated: !!user,
      isAdmin: user?.role === "admin" || user?.role === "super_admin",
      isSuperAdmin: user?.role === "super_admin",
      isLoading: isLoading || logoutMutation.isPending,
      logout,
    }),
    [user, isLoading, logoutMutation.isPending, logout],
  );
}

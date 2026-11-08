import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};
declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}
export default function Login() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { data: config } = trpc.auth.telegram.widgetConfig.useQuery();
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const verify = trpc.auth.telegram.verify.useMutation({
    onSuccess: () => {
      window.location.href = import.meta.env.BASE_URL;
    },
    onError: (error) =>
      setError(
        error.data?.code === "FORBIDDEN" ? "Доступ запрещён" : error.message,
      ),
  });
  const mutate = verify.mutate;
  useEffect(() => {
    const node = container.current;
    if (!config?.botName || !node) return;
    window.onTelegramAuth = (user) => mutate(user);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", config.botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    node.replaceChildren(script);
    return () => {
      delete window.onTelegramAuth;
      node.replaceChildren();
    };
  }, [config?.botName, mutate]);
  if (isAuthenticated && isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="text-xl font-semibold text-[#5C2A2A]">
            Глиняная мастерская
          </div>
          <p className="text-sm text-slate-500">Вход в админ-панель</p>
        </div>
        <div ref={container} className="flex justify-center min-h-[60px]" />
        {!config?.botName && (
          <p className="text-sm text-slate-500">Вход временно недоступен</p>
        )}
        {error && (
          <p
            role="alert"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Navigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { switchAccountPath, useAuth, useLogout } from "@/hooks/useAuth";
import { DeveloperContacts } from "@/components/DeveloperContacts";
import { Button } from "@/components/ui/button";
import loginBackgroundUrl from "@/assets/login-bg.webm?url";

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

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const preference = window.matchMedia?.(reducedMotionQuery);
  preference?.addEventListener("change", onChange);
  return () => preference?.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia?.(reducedMotionQuery).matches ?? false;
}

function LoginBackground() {
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
  );
  const { data } = trpc.adminAppearance.loginBackground.useQuery(undefined, {
    enabled: !reduceMotion,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const [playback, setPlayback] = useState<"pending" | "playing" | "failed">(
    "pending",
  );

  if (!data?.enabled || reduceMotion || playback === "failed") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <video
        className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
        src={loginBackgroundUrl}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onPlaying={() => setPlayback("playing")}
        onError={() => setPlayback("failed")}
      />
      <div
        className={
          playback === "playing"
            ? "absolute inset-0 bg-gradient-to-b from-slate-900/15 via-slate-900/25 to-slate-900/60"
            : "absolute inset-0 bg-slate-900"
        }
      />
    </div>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const switchingAccount = params.get("switch") === "1";
  const { user, isAdmin, isLoading } = useAuth();
  const { logout, isLoggingOut, logoutError } = useLogout();
  const showWidget = !isLoading && !isAdmin;
  const { data: config, isLoading: isConfigLoading } =
    trpc.auth.telegram.widgetConfig.useQuery(undefined, {
      enabled: showWidget,
    });
  const [error, setError] = useState("");
  const [loadedWidget, setLoadedWidget] = useState<string>();
  const botName = config?.botName;
  const container = useRef<HTMLDivElement>(null);
  const verify = trpc.auth.telegram.verify.useMutation({
    onSuccess: () => {
      window.location.href = import.meta.env.BASE_URL;
    },
    onError: (error) => setError(error.message),
  });
  const mutate = verify.mutate;
  useEffect(() => {
    const node = container.current;
    if (!showWidget || !botName || !node) return;
    window.onTelegramAuth = (user) => {
      setError("");
      mutate(user);
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    const widgetReady = () => setLoadedWidget(botName);
    script.addEventListener("load", widgetReady);
    script.addEventListener("error", widgetReady);
    node.replaceChildren(script);
    return () => {
      script.removeEventListener("load", widgetReady);
      script.removeEventListener("error", widgetReady);
      delete window.onTelegramAuth;
      node.replaceChildren();
    };
  }, [showWidget, botName, mutate]);

  if (isAdmin && !switchingAccount) return <Navigate to="/" replace />;

  const canLoadBackground =
    !isLoading &&
    (!showWidget ||
      (!isConfigLoading && (!botName || loadedWidget === botName)));

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-slate-900 px-4">
      {canLoadBackground && <LoginBackground />}
      <main className="flex flex-1 items-center justify-center py-8">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold text-[#5C2A2A]">
              Панель администратора
            </h1>
            <p className="text-sm text-slate-500">Вход через Telegram</p>
          </div>
          {isLoading && (
            <p role="status" className="text-center text-sm text-slate-500">
              Проверка сеанса…
            </p>
          )}
          {switchingAccount && isAdmin && user && (
            <div className="space-y-3 text-center">
              <div className="text-sm text-slate-700">
                <p>Текущий аккаунт</p>
                <p className="break-words font-medium">{user.displayName}</p>
                <p className="text-slate-500">
                  Telegram ID {user.telegramId} · {user.role}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => logout(switchAccountPath)}
                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
              >
                {isLoggingOut ? "Выход…" : "Войти в другой аккаунт"}
              </Button>
            </div>
          )}
          {showWidget && (
            <>
              <div
                ref={container}
                className="flex justify-center min-h-[60px]"
              />
              {!config?.botName && !isConfigLoading && (
                <p className="text-sm text-slate-500">
                  Вход временно недоступен
                </p>
              )}
              {switchingAccount && config?.botName && (
                <p className="text-sm text-slate-500">
                  Если виджет предлагает прежний аккаунт, переключите аккаунт в
                  Telegram и повторите вход.
                </p>
              )}
            </>
          )}
          {(logoutError || error) && (
            <p
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {logoutError || error}
            </p>
          )}
        </div>
      </main>
      <DeveloperContacts />
    </div>
  );
}

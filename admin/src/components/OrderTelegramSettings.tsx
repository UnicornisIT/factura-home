import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function OrderTelegramSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.orderNotifications.settings.useQuery();
  const [feedback, setFeedback] = useState<{
    text: string;
    error?: boolean;
  }>();
  const onError = (error: { message: string }) =>
    setFeedback({ text: error.message, error: true });
  const change = trpc.orderNotifications.setEnabled.useMutation({
    onError,
    onSuccess: ({ enabled }) => {
      utils.orderNotifications.settings.setData(
        undefined,
        (current) => current && { ...current, enabled },
      );
      setFeedback({
        text: enabled
          ? "Уведомления включены. Бот отправил проверочное сообщение."
          : "Уведомления выключены.",
      });
    },
  });
  const test = trpc.orderNotifications.test.useMutation({
    onError,
    onSuccess: () => setFeedback({ text: "Проверочное сообщение отправлено." }),
  });

  const busy = change.isPending || test.isPending;
  const current = settings.data;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="font-semibold text-slate-900">Telegram-уведомления</h2>
          <p className="text-sm text-slate-600">
            {settings.isError
              ? "Не удалось загрузить настройки."
              : current
                ? current.enabled
                  ? "Уведомления о новых заказах включены для вашего аккаунта."
                  : "Чтобы получать уведомления, откройте бота и нажмите /start."
                : "Загрузка настроек…"}
          </p>
          {current && !current.configured && (
            <p className="text-sm text-slate-600">
              Бот для уведомлений не настроен.
            </p>
          )}
        </div>
        {current && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={current.enabled ? "outline" : "default"}
              disabled={busy || (!current.enabled && !current.configured)}
              onClick={() => {
                setFeedback(undefined);
                change.mutate({ enabled: !current.enabled });
              }}
            >
              {current.enabled ? "Выключить" : "Включить"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !current.configured}
              onClick={() => {
                setFeedback(undefined);
                test.mutate();
              }}
            >
              Отправить проверочное сообщение
            </Button>
            {current.botUrl && (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={current.botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть бота
                </a>
              </Button>
            )}
          </div>
        )}
        {feedback && (
          <p
            role={feedback.error ? "alert" : "status"}
            className={
              feedback.error ? "text-sm text-red-700" : "text-sm text-slate-600"
            }
          >
            {feedback.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

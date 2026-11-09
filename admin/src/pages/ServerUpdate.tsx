import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ExternalLink } from "lucide-react";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function StateBadge({ state }: { state: "running" | "success" | "failed" }) {
  if (state === "running") return <Badge variant="warning">выполняется</Badge>;
  if (state === "success") return <Badge variant="success">успешно</Badge>;
  return <Badge variant="danger">ошибка</Badge>;
}

export default function ServerUpdate() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.system.updateStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false),
  });
  const startUpdate = trpc.system.startUpdate.useMutation({
    onSuccess: () => {
      void utils.system.updateStatus.invalidate();
    },
    onError: (e) => alert(e.message),
  });

  const enabled = data?.enabled ?? false;
  const running = data?.running ?? false;
  const currentVersion = data?.currentVersion ?? null;
  const latest = data?.latest ?? null;
  const upToDate =
    !!latest && !!currentVersion && latest.tag === `v${currentVersion}`;

  const handleUpdate = () => {
    if (
      latest &&
      confirm(
        `Обновить сервер до ${latest.tag}? Сервис будет перезапущен, магазин будет кратковременно недоступен.`,
      )
    ) {
      startUpdate.mutate();
    }
  };

  return (
    <AdminLayout
      title="Обновление сервера"
      description="Проверка последнего релиза и обновление магазина по кнопке"
      requireRole="super_admin"
    >
      {isLoading && <p className="text-sm text-slate-500">Загрузка…</p>}

      {!isLoading && !enabled && (
        <Card className="mb-6">
          <CardContent className="pt-6 text-sm text-slate-600">
            Обновление из панели выключено. Включите{" "}
            <code className="font-mono text-xs bg-slate-100 px-1 rounded">
              SERVER_UPDATE_ENABLED=true
            </code>{" "}
            в{" "}
            <code className="font-mono text-xs bg-slate-100 px-1 rounded">
              app/.env
            </code>{" "}
            и установите скрипт обновления через{" "}
            <code className="font-mono text-xs bg-slate-100 px-1 rounded">
              deployment/setup.sh
            </code>
            .
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>На сервере</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Текущая версия</span>
              <span className="font-mono font-medium">
                {currentVersion ? `v${currentVersion}` : "не определена"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Репозиторий</span>
              <span className="font-mono text-xs">{data?.repository}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Статус</span>
              {running ? (
                <StateBadge state="running" />
              ) : (
                <Badge variant="outline">
                  {enabled ? "готово к обновлению" : "выключено"}
                </Badge>
              )}
            </div>

            {data?.lastOperation && (
              <div className="border-t pt-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Последняя операция</span>
                  <StateBadge state={data.lastOperation.state} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Версия</span>
                  <span className="font-mono text-xs">
                    {data.lastOperation.tag ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Завершено</span>
                  <span className="text-xs">
                    {formatDate(data.lastOperation.finishedAt)}
                  </span>
                </div>
                {data.lastOperation.message && (
                  <p className="text-xs text-slate-500 break-words">
                    {data.lastOperation.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Последний релиз</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.latestError && (
              <p className="text-xs text-red-700">{data.latestError}</p>
            )}
            {!latest && !data?.latestError && (
              <p className="text-slate-500">
                В репозитории пока нет релизов. Создайте тег{" "}
                <code className="font-mono text-xs bg-slate-100 px-1 rounded">
                  v*
                </code>
                , и workflow опубликует релиз.
              </p>
            )}
            {latest && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Версия</span>
                  <span className="font-mono font-medium">{latest.tag}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Опубликован</span>
                  <span className="text-xs">
                    {formatDate(latest.publishedAt)}
                  </span>
                </div>
                {latest.url && (
                  <a
                    href={latest.url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-xs text-[#5C2A2A] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Релиз на GitHub
                  </a>
                )}
                {latest.notes && (
                  <div className="border-t pt-3">
                    <div className="text-slate-500 mb-1">Заметки</div>
                    <pre className="text-xs whitespace-pre-wrap font-sans text-slate-700 max-h-48 overflow-y-auto">
                      {latest.notes}
                    </pre>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          onClick={handleUpdate}
          disabled={
            !enabled || running || !latest || upToDate || startUpdate.isPending
          }
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${running || startUpdate.isPending ? "animate-spin" : ""}`}
          />
          {running || startUpdate.isPending
            ? "Обновление выполняется…"
            : latest
              ? `Обновить до ${latest.tag}`
              : "Обновить"}
        </Button>
        {upToDate && (
          <span className="text-sm text-slate-500">
            Установлена последняя версия
          </span>
        )}
        {running && (
          <span className="text-sm text-slate-500">
            Статус обновляется автоматически каждые 5 секунд
          </span>
        )}
      </div>

      {startUpdate.isSuccess && !running && (
        <p className="mt-3 text-sm text-slate-600">
          Обновление запущено. Сервис будет перезапущен; страница может
          кратковременно не отвечать — обновите её через минуту.
        </p>
      )}
    </AdminLayout>
  );
}

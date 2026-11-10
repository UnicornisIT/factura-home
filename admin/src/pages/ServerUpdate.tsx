import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { installationStatus, isHistoricalFailure } from "./server-update-state";

// Этапы должны совпадать со стадиями deployment/factura-update.sh.
const STAGES = [
  "проверка окружения",
  "проверка доступа к GitHub",
  "загрузка информации о релизе",
  "создание резервных копий",
  "получение исходного кода",
  "установка зависимостей",
  "сборка приложения и админ-панели",
  "миграция базы данных",
  "установка deployment-файлов",
  "перезапуск сервиса",
  "проверка работоспособности",
  "завершено",
] as const;

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

function StageProgress({ stage }: { stage: string | null }) {
  const current = stage ? STAGES.indexOf(stage.toLowerCase() as never) : -1;
  return (
    <ol className="space-y-1">
      {STAGES.map((name, index) => {
        const done = current >= 0 && index < current;
        const active = index === current || (current < 0 && index === 0);
        return (
          <li
            key={name}
            className={`flex items-center gap-2 text-xs ${
              active
                ? "font-medium text-slate-800"
                : done
                  ? "text-slate-500"
                  : "text-slate-300"
            }`}
          >
            {done ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : active ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#5C2A2A]" />
            ) : (
              <span className="h-3 w-3 shrink-0 rounded-full border border-current" />
            )}
            <span className="capitalize">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ServerUpdate() {
  const utils = trpc.useUtils();
  // Ждём подтверждения результата сервером: во время перезапуска API может
  // временно не отвечать, и это не должно показываться как успех.
  const [awaitingResult, setAwaitingResult] = useState(false);
  const clickedAtRef = useRef(0);
  const { data, isLoading, isError } = trpc.system.updateStatus.useQuery(
    undefined,
    {
      refetchInterval: (query) =>
        query.state.data?.running || awaitingResult ? 3000 : false,
    },
  );
  const startUpdate = trpc.system.startUpdate.useMutation({
    onSuccess: () => {
      clickedAtRef.current = Date.now();
      setAwaitingResult(true);
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
  const status = installationStatus({
    running,
    enabled,
    upToDate,
    latestKnown: !!latest || !!data?.latestError,
  });

  // Операция, запущенная из этой сессии панели (по времени клика).
  const op = data?.lastOperation ?? null;
  const tracked =
    op?.startedAt && Date.parse(op.startedAt) >= clickedAtRef.current - 5000
      ? op
      : null;

  useEffect(() => {
    if (!awaitingResult || !data || !op?.startedAt) return;
    if (
      Date.parse(op.startedAt) >= clickedAtRef.current - 5000 &&
      !data.running
    ) {
      setAwaitingResult(false);
    }
  }, [awaitingResult, data, op]);

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

      {awaitingResult && isError && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-800">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Сервис перезапускается, API временно недоступен. Подключение
            повторяется автоматически — не закрывайте страницу.
          </CardContent>
        </Card>
      )}

      {!awaitingResult && tracked && tracked.state !== "running" && (
        <Card
          className={`mb-6 ${
            tracked.state === "success"
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <CardContent className="pt-6 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <StateBadge state={tracked.state} />
              {tracked.state === "success"
                ? `Обновление до ${tracked.tag ?? "новой версии"} подтверждено сервером`
                : "Обновление завершилось ошибкой"}
            </div>
            {tracked.message && (
              <p className="mt-1 text-xs text-slate-600 break-words">
                {tracked.message}
              </p>
            )}
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
              {status === "running" && <StateBadge state="running" />}
              {status === "up-to-date" && (
                <Badge variant="success">установлена последняя версия</Badge>
              )}
              {(status === "update-available" || status === "unknown") && (
                <Badge variant="outline">готово к обновлению</Badge>
              )}
              {status === "disabled" && (
                <Badge variant="outline">выключено</Badge>
              )}
            </div>

            {running && (
              <div className="border-t pt-3">
                <div className="text-slate-500 mb-2">Текущий этап</div>
                <StageProgress stage={op?.stage ?? null} />
              </div>
            )}

            {op && !running && (
              <div className="border-t pt-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">
                    Последняя операция (история)
                  </span>
                  <StateBadge state={op.state} />
                </div>
                {isHistoricalFailure(upToDate, op) && (
                  <p className="text-xs text-slate-400">
                    Ошибка относится к прошлой попытке обновления — сейчас
                    установлена актуальная версия, действий не требуется.
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Версия</span>
                  <span className="font-mono text-xs">{op.tag ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Завершено</span>
                  <span className="text-xs">{formatDate(op.finishedAt)}</span>
                </div>
                {op.message && (
                  <p className="text-xs text-slate-500 break-words">
                    {op.message}
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
                В репозитории нет релизов, либо он недоступен с текущим{" "}
                <code className="font-mono text-xs bg-slate-100 px-1 rounded">
                  GITHUB_TOKEN
                </code>
                . Для приватного репозитория нужен fine-grained PAT (Contents:
                Read-only).
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
            !enabled ||
            running ||
            awaitingResult ||
            !latest ||
            upToDate ||
            startUpdate.isPending
          }
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${running || startUpdate.isPending ? "animate-spin" : ""}`}
          />
          {running || awaitingResult || startUpdate.isPending
            ? "Обновление выполняется…"
            : latest
              ? `Обновить до ${latest.tag}`
              : "Обновить"}
        </Button>
        {upToDate && !awaitingResult && (
          <span className="text-sm text-slate-500">
            Установлена последняя версия
          </span>
        )}
        {running && (
          <span className="text-sm text-slate-500">
            Статус обновляется автоматически каждые 3 секунды
          </span>
        )}
      </div>
    </AdminLayout>
  );
}

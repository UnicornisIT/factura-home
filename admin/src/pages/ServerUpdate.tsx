import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReleaseNotes } from "@/components/ReleaseNotes";
import { UpdateHistory } from "@/components/UpdateHistory";
import { formatDateTime } from "@/lib/utils";
import { Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { installationStatus } from "./server-update-state";

function StateBadge({ state }: { state: "running" | "success" | "failed" }) {
  if (state === "running") return <Badge variant="warning">выполняется</Badge>;
  if (state === "success") return <Badge variant="success">успешно</Badge>;
  return <Badge variant="danger">ошибка</Badge>;
}

export default function ServerUpdate() {
  const utils = trpc.useUtils();
  // Ждём подтверждения результата сервером: во время перезапуска API может
  // временно не отвечать, и это не должно показываться как успех.
  const [awaitingResult, setAwaitingResult] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const clickedAtRef = useRef(0);
  const operationIdRef = useRef<string | null>(null);
  const { data, isLoading, isError } = trpc.system.updateStatus.useQuery(
    undefined,
    {
      refetchInterval: (query) =>
        query.state.data?.running || awaitingResult ? 3000 : false,
    },
  );
  const startUpdate = trpc.system.startUpdate.useMutation({
    onSuccess: ({ operationId }) => {
      operationIdRef.current = operationId;
      setAwaitingResult(true);
      void utils.system.updateStatus.invalidate();
    },
  });

  const enabled = data?.enabled ?? false;
  const running = data?.running ?? false;
  const currentVersion = data?.currentVersion ?? null;
  const latest = data?.latest ?? null;
  const comparison = data?.latestComparison;
  const upToDate = comparison === 0;
  const older = comparison === -1;
  const status = installationStatus({
    running,
    enabled,
    upToDate,
    latestKnown: comparison === 1,
  });

  const op = data?.lastOperation ?? null;

  useEffect(() => {
    if (!awaitingResult) return;
    const matches =
      (!!op?.operationId && op.operationId === operationIdRef.current) ||
      (op?.source === undefined &&
        !!op?.startedAt &&
        Date.parse(op.startedAt) >= clickedAtRef.current - 1000);
    const timeout = window.setTimeout(
      () => {
        setAwaitingResult(false);
        setUnconfirmed(!matches || (op?.state === "running" && !data?.running));
      },
      matches ? 0 : Math.max(0, 60_000 - (Date.now() - clickedAtRef.current)),
    );
    return () => window.clearTimeout(timeout);
  }, [awaitingResult, data, op]);

  const handleUpdate = () => {
    if (
      latest &&
      confirm(
        `${upToDate ? "Повторно установить" : older ? "Установить" : "Обновить до"} ${latest.tag}? Магазин будет временно недоступен.`,
      )
    ) {
      clickedAtRef.current = Date.now();
      setUnconfirmed(false);
      startUpdate.mutate();
    }
  };

  return (
    <AdminLayout title="Обновление сервера" requireRole="super_admin">
      {isLoading && <p className="text-sm text-slate-500">Загрузка…</p>}

      {data && !enabled && (
        <Card className="mb-6">
          <CardContent className="pt-6 text-sm text-slate-600">
            Обновление из панели недоступно.
          </CardContent>
        </Card>
      )}

      {(awaitingResult || running) && isError && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardContent role="status" className="pt-6 text-sm text-amber-800">
            <Loader2 className="mr-2 inline h-4 w-4 motion-safe:animate-spin" />
            Ждём ответа магазина после перезапуска…
          </CardContent>
        </Card>
      )}

      {unconfirmed && !running && (
        <p role="status" className="mb-6 text-sm text-amber-800">
          Итог запрошенной операции пока не подтверждён. Проверьте историю
          обновлений.
        </p>
      )}

      {((isError && !data && !awaitingResult) || startUpdate.isError) && (
        <p role="alert" className="mb-6 text-sm text-red-700">
          {startUpdate.isError
            ? "Не удалось запустить обновление. Попробуйте ещё раз."
            : "Не удалось проверить состояние обновления."}
        </p>
      )}

      {!awaitingResult && !running && op && op.state !== "running" && (
        <Card
          className={`mb-6 ${
            op.state === "success"
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <CardContent role="status" className="pt-6 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <StateBadge state={op.state} />
              {op.state === "success"
                ? op.message === "already up to date"
                  ? "Обновление не требовалось"
                  : op.tag
                    ? `Обновление до ${op.tag} завершено`
                    : "Обновление завершено"
                : "Последнее обновление завершилось ошибкой"}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>На сервере</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-500">Текущая версия</span>
              <span className="font-mono font-medium">
                {currentVersion ? `v${currentVersion}` : "не определена"}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-500">Статус</span>
              {(running || awaitingResult) && <StateBadge state="running" />}
              {!awaitingResult && status === "up-to-date" && (
                <Badge variant="success">последняя версия</Badge>
              )}
              {!awaitingResult && status === "update-available" && (
                <Badge variant="outline">доступно обновление</Badge>
              )}
              {!awaitingResult && status === "unknown" && (
                <Badge variant="outline">
                  {older
                    ? "на сервере более новая версия"
                    : latest
                      ? "версию релиза не удалось сравнить"
                      : "нет данных о релизе"}
                </Badge>
              )}
              {data && !awaitingResult && status === "disabled" && (
                <Badge variant="outline">недоступно</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Последний релиз</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data && !latest && (
              <p className="text-slate-500">
                {data.latestError
                  ? "Не удалось загрузить сведения о последнем релизе."
                  : "Сведения о релизе недоступны."}
              </p>
            )}
            {latest && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-500">Версия</span>
                  <span className="font-mono font-medium">{latest.tag}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-500">Опубликован</span>
                  <span className="text-xs">
                    {formatDateTime(latest.publishedAt)}
                  </span>
                </div>
                {latest.url && (
                  <Button asChild variant="outline" size="sm">
                    <a href={latest.url} target="_blank" rel="noopener">
                      <ExternalLink />
                      Релиз на GitHub
                    </a>
                  </Button>
                )}
                {latest.notes?.trim() && (
                  <div className="release-summary border-t pt-3">
                    <h2 className="mb-2 font-medium">Что нового</h2>
                    <ReleaseNotes notes={latest.notes} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          className="h-auto min-h-9 max-w-full whitespace-normal"
          onClick={handleUpdate}
          disabled={
            !enabled ||
            running ||
            awaitingResult ||
            !latest ||
            startUpdate.isPending
          }
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${running || startUpdate.isPending ? "motion-safe:animate-spin" : ""}`}
          />
          {running || awaitingResult || startUpdate.isPending
            ? "Обновление выполняется…"
            : latest
              ? `${upToDate ? "Повторно установить" : older ? "Установить" : "Обновить до"} ${latest.tag}`
              : "Обновить"}
        </Button>
      </div>
      <UpdateHistory />
    </AdminLayout>
  );
}

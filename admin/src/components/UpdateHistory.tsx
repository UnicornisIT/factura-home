import { useState } from "react";
import { updateRollbackLabels } from "@contracts/update-notifications";
import { formatDateTime } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const status = {
  running: { text: "Выполняется", variant: "warning" },
  success: { text: "Успешно", variant: "success" },
  failed: { text: "Ошибка", variant: "danger" },
  unconfirmed: { text: "Итог не подтверждён", variant: "warning" },
} as const;

export function UpdateHistory() {
  const [page, setPage] = useState(0);
  const history = trpc.system.updateHistory.useQuery(
    { page },
    { refetchInterval: 5000 },
  );
  return (
    <Card className="mt-6 min-w-0">
      <CardHeader>
        <CardTitle>История обновлений</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {history.isPending && <p role="status">Загрузка…</p>}
        {history.isError && (
          <p role="alert" className="text-red-700">
            Не удалось загрузить историю обновлений.
          </p>
        )}
        {history.data?.items.length === 0 && <p>Попыток установки пока нет.</p>}
        {!!history.data?.items.length && (
          <ul className="grid min-w-0 gap-3">
            {history.data.items.map((operation) => (
              <li
                key={operation.operationId}
                className="min-w-0 space-y-2 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {operation.fromVersion ?? "—"} →{" "}
                    {operation.targetVersion ?? "—"}
                  </span>
                  <Badge variant={status[operation.state].variant}>
                    {status[operation.state].text}
                  </Badge>
                </div>
                <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Начало</dt>
                    <dd>{formatDateTime(operation.startedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Завершение</dt>
                    <dd>{formatDateTime(operation.finishedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Инициатор</dt>
                    <dd>
                      {operation.initiatedBy !== null
                        ? `Telegram ID ${operation.initiatedBy}`
                        : operation.source === "manual"
                          ? "Системная / ручная операция"
                          : "Не определён"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Операция</dt>
                    <dd className="break-all font-mono text-xs">
                      {operation.operationId}
                    </dd>
                  </div>
                </dl>
                {(operation.diagnostic || operation.rollback) && (
                  <p className="text-slate-700">
                    {operation.diagnostic}{" "}
                    {operation.rollback &&
                      updateRollbackLabels[operation.rollback]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {(page > 0 || history.data?.hasNext) && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!history.data?.hasNext}
              onClick={() => setPage(page + 1)}
            >
              Далее
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

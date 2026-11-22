export const updateEventTitles = {
  update_available: "Доступна новая версия",
  update_started: "Началась установка обновления",
  update_success: "Обновление установлено",
  update_failed: "Не удалось установить обновление",
} as const;

export type UpdateEventKind = keyof typeof updateEventTitles;
export type UpdateRollback = "restored" | "failed" | "in_progress";

export const updateRollbackLabels: Record<UpdateRollback, string> = {
  restored: "Откат завершён, магазин работает.",
  failed: "Откат не удался. Требуется вмешательство.",
  in_progress: "Результат отката неизвестен.",
};

export function updateEventDescription(event: {
  kind: UpdateEventKind;
  version: string | null;
  rollback: UpdateRollback | null;
}) {
  const version = event.version ? ` ${event.version}` : "";
  switch (event.kind) {
    case "update_available":
      return `Доступна версия${version}.`;
    case "update_started":
      return `Началась установка${version}.`;
    case "update_success":
      return `Версия${version} установлена. Работоспособность магазина подтверждена.`;
    case "update_failed":
      return `Установка${version} прервана. ${event.rollback ? updateRollbackLabels[event.rollback] : ""}`.trim();
  }
}

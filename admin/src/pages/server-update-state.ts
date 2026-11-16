export type UpdateOperationState = "running" | "success" | "failed";

export type InstallationStatus =
  "running" | "up-to-date" | "update-available" | "unknown" | "disabled";

/** Сводное состояние установки для строки «Статус». */
export function installationStatus(input: {
  running: boolean;
  enabled: boolean;
  upToDate: boolean;
  latestKnown: boolean;
}): InstallationStatus {
  if (input.running) return "running";
  if (!input.enabled) return "disabled";
  if (input.upToDate) return "up-to-date";
  return input.latestKnown ? "update-available" : "unknown";
}

import { describe, expect, it } from "vitest";
import { installationStatus, isHistoricalFailure } from "./server-update-state";

describe("isHistoricalFailure", () => {
  it("помечает ошибку прошлой операции как устаревшую при актуальной версии", () => {
    expect(isHistoricalFailure(true, { state: "failed" })).toBe(true);
  });

  it("не помечает ошибку, если версия не актуальна или операция успешна", () => {
    expect(isHistoricalFailure(false, { state: "failed" })).toBe(false);
    expect(isHistoricalFailure(true, { state: "success" })).toBe(false);
    expect(isHistoricalFailure(true, { state: "running" })).toBe(false);
    expect(isHistoricalFailure(true, null)).toBe(false);
    expect(isHistoricalFailure(true, undefined)).toBe(false);
  });
});

describe("installationStatus", () => {
  const base = {
    running: false,
    enabled: true,
    upToDate: false,
    latestKnown: true,
  };

  it("приоритет: выполняется > выключено > актуально > доступно обновление", () => {
    expect(installationStatus({ ...base, running: true })).toBe("running");
    expect(installationStatus({ ...base, running: true, enabled: false })).toBe(
      "running",
    );
    expect(installationStatus({ ...base, enabled: false })).toBe("disabled");
    expect(installationStatus({ ...base, upToDate: true })).toBe("up-to-date");
    expect(installationStatus(base)).toBe("update-available");
    expect(installationStatus({ ...base, latestKnown: false })).toBe("unknown");
  });
});

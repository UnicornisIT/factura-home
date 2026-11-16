import { describe, expect, it } from "vitest";
import { installationStatus } from "./server-update-state";

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

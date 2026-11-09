import { TRPCError } from "@trpc/server";

import { createRouter, superAdminQuery } from "./middleware";
import { audit, securitySql } from "./queries/security-store";
import { env } from "./lib/env";
import {
  fetchLatestRelease,
  isUpdateRunning,
  readCurrentVersion,
  readUpdateStatus,
  startUpdate,
} from "./lib/system-update";

export const systemRouter = createRouter({
  updateStatus: superAdminQuery.query(async () => {
    const [currentVersion, lastOperation] = await Promise.all([
      readCurrentVersion(),
      readUpdateStatus(),
    ]);
    let latest = null;
    let latestError: string | null = null;
    try {
      latest = await fetchLatestRelease();
    } catch (error) {
      latestError =
        error instanceof TRPCError
          ? error.message
          : "Не удалось получить данные о релизах GitHub";
    }
    return {
      enabled: env.serverUpdateEnabled,
      repository: env.serverUpdateRepository,
      currentVersion,
      latest,
      latestError,
      lastOperation,
      running: isUpdateRunning(lastOperation),
    };
  }),

  startUpdate: superAdminQuery.mutation(async ({ ctx }) => {
    const result = await startUpdate();
    await audit(
      securitySql,
      ctx.user.telegramId,
      "system.update",
      null,
      null,
      null
    );
    return result;
  }),
});

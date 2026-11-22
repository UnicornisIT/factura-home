import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createRouter, superAdminQuery } from "./middleware";
import { audit, securitySql } from "./queries/security-store";
import { env } from "./lib/env";
import { log } from "./lib/logger";
import {
  recordUpdateRequest,
  updateHistory,
} from "./queries/update-notifications";
import {
  compareStableRelease,
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
      latestComparison: latest
        ? compareStableRelease(latest.tag, currentVersion)
        : null,
      lastOperation: lastOperation && {
        ...lastOperation,
        message:
          lastOperation.message === "already up to date"
            ? lastOperation.message
            : null,
      },
      running: isUpdateRunning(lastOperation),
    };
  }),

  updateHistory: superAdminQuery
    .input(
      z
        .object({ page: z.number().int().min(0).max(10_000).default(0) })
        .strict()
    )
    .query(({ input }) => updateHistory(input.page)),

  startUpdate: superAdminQuery.mutation(async ({ ctx }) => {
    const operationId = randomUUID();
    const result = await startUpdate({
      operationId,
      beforeLaunch: () => recordUpdateRequest(operationId, ctx.user.telegramId),
    });
    await audit(
      securitySql,
      ctx.user.telegramId,
      "system.update",
      null,
      null,
      null
    ).catch(() => log.error("Could not audit update request"));
    return { ...result, operationId };
  }),
});

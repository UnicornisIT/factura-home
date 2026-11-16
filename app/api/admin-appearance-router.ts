import { z } from "zod";
import { env } from "./lib/env";
import { adminQuery, createRouter, publicQuery } from "./middleware";
import { runSqlTransaction, securitySql } from "./queries/security-store";

export const adminAppearanceRouter = createRouter({
  loginBackground: publicQuery.query(async () => {
    const [settings] = await securitySql(
      "SELECT loginBackgroundEnabled FROM adminAppearance WHERE id = 1"
    );
    return { enabled: Number(settings?.loginBackgroundEnabled ?? 1) === 1 };
  }),

  setLoginBackground: adminQuery
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) =>
      runSqlTransaction(function* () {
        const upsert =
          env.dbDialect === "mysql"
            ? "ON DUPLICATE KEY UPDATE loginBackgroundEnabled = ?"
            : "ON CONFLICT(id) DO UPDATE SET loginBackgroundEnabled = ?";
        const enabled = Number(input.enabled);
        yield [
          `INSERT INTO adminAppearance (id, loginBackgroundEnabled) VALUES (1, ?) ${upsert}`,
          [enabled, enabled],
        ];
        return input;
      })
    ),
});

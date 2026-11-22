import { z } from "zod";
import { adminQuery, createRouter } from "./middleware";
import { telegramSettings, testTelegramChat } from "./lib/telegram-settings";
import {
  changeUpdateTelegramPreference,
  markUpdateRead,
  updateInbox,
  updateTelegramPreference,
} from "./queries/update-notifications";

const sendTest = (telegramId: number) =>
  testTelegramChat(telegramId, "update", updateTelegramPreference);

export const updateNotificationsRouter = createRouter({
  inbox: adminQuery
    .input(
      z
        .object({ page: z.number().int().min(0).max(10_000).default(0) })
        .strict()
    )
    .query(({ input, ctx }) => updateInbox(ctx.user.telegramId, input.page)),
  markRead: adminQuery
    .input(z.object({ eventId: z.number().int().positive() }).strict())
    .mutation(({ input, ctx }) =>
      markUpdateRead(ctx.user.telegramId, input.eventId)
    ),
  markAllRead: adminQuery.mutation(({ ctx }) =>
    markUpdateRead(ctx.user.telegramId)
  ),
  settings: adminQuery.query(async ({ ctx }) =>
    telegramSettings(await updateTelegramPreference(ctx.user.telegramId))
  ),
  setEnabled: adminQuery
    .input(z.object({ enabled: z.boolean() }).strict())
    .mutation(async ({ input, ctx }) => {
      const { telegramId } = ctx.user;
      if (input.enabled) await sendTest(telegramId);
      await changeUpdateTelegramPreference(telegramId, input.enabled);
      return { enabled: input.enabled };
    }),
  test: adminQuery.mutation(async ({ ctx }) => {
    await sendTest(ctx.user.telegramId);
    return { sent: true };
  }),
});

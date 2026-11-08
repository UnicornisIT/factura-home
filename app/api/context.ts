import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

import { verifySessionToken, sessionToken } from "./session";

import { findActiveByTelegramId } from "./queries/admin-allowlist";

export type AuthUser = {
  authMethod: "telegram";
  role: string;
  telegramId: number;
  displayName?: string;
  photoUrl?: string;
};

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: AuthUser;
};

export async function createContext(
  opts: FetchCreateContextFnOptions
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  const token = sessionToken(opts.req);

  if (!token) return ctx;

  const claim = await verifySessionToken(token);

  if (!claim) return ctx;

  const entry = await findActiveByTelegramId(claim.telegramId);

  if (entry)
    ctx.user = {
      authMethod: "telegram",
      role: entry.role,
      telegramId: entry.telegramId,
      displayName: claim.firstName || claim.username || "Администратор",
      photoUrl: claim.photoUrl,
    };

  return ctx;
}

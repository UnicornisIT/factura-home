import type { CookieOptions } from "hono/utils/cookie";
import { env } from "./env";
export function getSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: env.isProduction,
  };
}

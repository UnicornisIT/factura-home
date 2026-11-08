import { randomBytes, createHmac } from "node:crypto";

import { env } from "./lib/env";
import * as cookie from "cookie";

import { Session } from "@contracts/constants";

import {
  securityTransaction,
  securitySql,
  type Sql,
} from "./queries/security-store";

import { getSessionCookieOptions } from "./lib/cookies";

export type SessionPayload = {
  authMethod: "telegram";
  role: string;
  telegramId: number;
  username?: string;
  firstName?: string;
  photoUrl?: string;
};

const digest = (value: string) =>
  createHmac("sha256", env.appSecret).update(value).digest("hex");

export async function issueSession(sql: Sql, payload: SessionPayload) {
  const token = randomBytes(32).toString("base64url");

  await sql("DELETE FROM adminSessions WHERE expiresAt <= ?", [Date.now()]);

  await sql(
    "INSERT INTO adminSessions (tokenHash, telegramId, payload, expiresAt) VALUES (?, ?, ?, ?)",
    [
      digest(token),
      payload.telegramId,
      JSON.stringify(payload),
      Date.now() + Session.maxAgeMs,
    ]
  );

  return token;
}

export async function signSessionToken(payload: SessionPayload) {
  return securityTransaction(sql => issueSession(sql, payload));
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const [row] = await securitySql(
    "SELECT s.payload FROM adminSessions s JOIN adminAllowlist a ON a.telegramId = s.telegramId WHERE s.tokenHash = ? AND s.expiresAt > ? AND a.isActive = 1",
    [digest(token), Date.now()]
  );

  return row ? JSON.parse(row.payload as string) : null;
}

export function sessionToken(req: Request) {
  return cookie.parse(req.headers.get("cookie") || "")[Session.cookieName];
}

export async function revokeSession(req: Request, sql: Sql = securitySql) {
  const token = sessionToken(req);

  if (token)
    await sql("DELETE FROM adminSessions WHERE tokenHash = ?", [digest(token)]);
}

export function setSessionCookie(headers: Headers, token: string) {
  const { httpOnly, path, secure } = getSessionCookieOptions();
  headers.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly,
      path,
      secure,
      sameSite: "lax",
      maxAge: token ? Session.maxAgeMs / 1000 : 0,
    })
  );
}

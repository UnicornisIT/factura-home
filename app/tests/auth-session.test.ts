import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, addAllowlistEntry } from "./helpers";
import {
  signSessionToken,
  verifySessionToken,
  revokeSession,
} from "../api/session";
import { securitySql } from "../api/queries/security-store";
import { Session } from "../contracts/constants";
beforeEach(async () => {
  resetDb();
  await addAllowlistEntry({ telegramId: 200 });
});
const payload = {
  authMethod: "telegram" as const,
  role: "admin",
  telegramId: 200,
  firstName: "Test",
};
describe("server sessions", () => {
  it("issues unpredictable tokens and rejects tampering", async () => {
    const token = await signSessionToken(payload);
    expect((await verifySessionToken(token))?.telegramId).toBe(200);
    expect(await verifySessionToken(token.slice(1) + "!")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    expect(await signSessionToken(payload)).not.toBe(token);
  });
  it("rejects expired sessions", async () => {
    const token = await signSessionToken(payload);
    await securitySql("UPDATE adminSessions SET expiresAt = 0");
    expect(await verifySessionToken(token)).toBeNull();
  });
  it("revokes a logged out token on the server", async () => {
    const token = await signSessionToken(payload);
    await revokeSession(
      new Request("http://localhost:3000", {
        headers: { cookie: `${Session.cookieName}=${token}` },
      })
    );
    expect(await verifySessionToken(token)).toBeNull();
  });
});

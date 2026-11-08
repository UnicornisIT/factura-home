import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, addAllowlistEntry } from "./helpers";
import {
  ensureOwner,
  changeAccess,
  findActiveByTelegramId,
  listAllowlist,
} from "../api/queries/admin-allowlist";
import { signSessionToken, verifySessionToken } from "../api/session";
import { securitySql } from "../api/queries/security-store";
beforeEach(() => resetDb());
describe("access lifecycle", () => {
  it("bootstraps only the configured owner even with a nonempty allowlist, idempotently", async () => {
    await addAllowlistEntry({ telegramId: 900 });
    await Promise.all([ensureOwner(), ensureOwner(), ensureOwner()]);
    expect((await findActiveByTelegramId(100))?.role).toBe("super_admin");
    expect((await findActiveByTelegramId(900))?.role).toBe("admin");
    expect(
      (await listAllowlist()).filter(r => r.telegramId === 100)
    ).toHaveLength(1);
  });
  it("protects owner through all mutation paths", async () => {
    await ensureOwner();
    await changeAccess(100, 200, "add", "super_admin");
    for (const operation of ["add", "role", "deactivate"] as const)
      await expect(changeAccess(200, 100, operation, "admin")).rejects.toThrow(
        "защищены"
      );
    expect((await findActiveByTelegramId(100))?.role).toBe("super_admin");
  });
  it("denies ordinary admins and unknown IDs", async () => {
    await ensureOwner();
    await changeAccess(100, 200, "add");
    await expect(changeAccess(200, 300, "add")).rejects.toThrow(
      "Доступ запрещён"
    );
    await expect(changeAccess(999, 300, "add")).rejects.toThrow(
      "Доступ запрещён"
    );
  });
  it("revokes sessions permanently even after reactivation and logs changes", async () => {
    await ensureOwner();
    await changeAccess(100, 200, "add");
    const token = await signSessionToken({
      authMethod: "telegram",
      role: "admin",
      telegramId: 200,
    });
    await changeAccess(100, 200, "deactivate");
    expect(await verifySessionToken(token)).toBeNull();
    await changeAccess(100, 200, "add");
    expect(await verifySessionToken(token)).toBeNull();
    expect((await securitySql("SELECT * FROM adminAuditLog")).length).toBe(3);
  });
  it("keeps owner during competing changes and prevents a revoked actor from editing access", async () => {
    await ensureOwner();
    await changeAccess(100, 200, "add", "super_admin");
    await changeAccess(100, 300, "add", "super_admin");
    await Promise.allSettled([
      changeAccess(200, 300, "deactivate"),
      changeAccess(300, 200, "deactivate"),
      changeAccess(200, 100, "role", "admin"),
    ]);
    expect((await findActiveByTelegramId(100))?.role).toBe("super_admin");
  });
});

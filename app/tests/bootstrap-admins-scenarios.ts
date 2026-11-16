import assert from "node:assert/strict";
import {
  addInitialAdmins,
  changeAccess,
  ensureOwner,
  findActiveByTelegramId,
} from "../api/queries/admin-allowlist";
import { securitySql } from "../api/queries/security-store";

export async function checkInitialAdmins() {
  const owner = 100;
  const [ordinary, second, third, unknown] = [901, 902, 903, 904];
  await ensureOwner();
  assert.equal((await findActiveByTelegramId(owner))?.role, "super_admin");
  assert.deepEqual(await addInitialAdmins([]), { added: 0, preserved: [] });

  for (const ids of [
    [ordinary, 0],
    [-1],
    [1.5],
    [Number.MAX_SAFE_INTEGER + 1],
    [ordinary, ordinary],
    [ordinary, owner],
  ]) {
    await assert.rejects(addInitialAdmins(ids));
    assert.equal(await findActiveByTelegramId(ordinary), undefined);
  }

  assert.deepEqual(await addInitialAdmins([ordinary]), {
    added: 1,
    preserved: [],
  });
  assert.deepEqual(await addInitialAdmins([second, third]), {
    added: 2,
    preserved: [],
  });
  assert.equal((await findActiveByTelegramId(ordinary))?.role, "admin");
  const [audit] = await securitySql(
    "SELECT actorTelegramId, roleAfter FROM adminAuditLog WHERE targetTelegramId = ? AND action = 'access.add'",
    [ordinary]
  );
  assert.equal(Number(audit?.actorTelegramId), owner);
  assert.equal(audit?.roleAfter, "admin");
  assert.equal(
    Number((await findActiveByTelegramId(ordinary))?.addedByTelegramId),
    owner
  );
  await changeAccess(owner, ordinary, "deactivate");
  await changeAccess(owner, second, "role", "super_admin");
  assert.deepEqual(await addInitialAdmins([ordinary, second, third]), {
    added: 0,
    preserved: [ordinary, second, third],
  });
  assert.equal(await findActiveByTelegramId(ordinary), undefined);
  assert.equal((await findActiveByTelegramId(second))?.role, "super_admin");
  assert.equal((await findActiveByTelegramId(third))?.role, "admin");
  assert.equal(await findActiveByTelegramId(unknown), undefined);
  assert.equal((await findActiveByTelegramId(owner))?.role, "super_admin");
}

import { expect, it, vi } from "vitest";
import type { Sql } from "../api/queries/security-store";
import { applyMysqlStatement } from "../db/mysql-migrations";

const logo = "ALTER TABLE siteContent ADD COLUMN logoImage TEXT NULL";
const contacts =
  "ALTER TABLE orders ADD COLUMN contactDetails JSON NULL, " +
  "ADD COLUMN requestKey VARCHAR(64) NULL, " +
  "ADD UNIQUE INDEX orders_requestKey_unique (requestKey)";

it("applies a missing column and skips its exact definition after interruption", async () => {
  const execute = vi.fn<Sql>().mockResolvedValue([]);
  await applyMysqlStatement(execute, logo);
  expect(execute).toHaveBeenLastCalledWith(logo);

  execute
    .mockReset()
    .mockResolvedValue([
      { type: "text", nullable: "YES", defaultValue: null, extra: "" },
    ]);
  await applyMysqlStatement(execute, logo);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps an incompatible column out of the migration journal", async () => {
  const execute = vi
    .fn<Sql>()
    .mockResolvedValue([
      { type: "varchar(10)", nullable: "YES", defaultValue: null, extra: "" },
    ]);
  await expect(applyMysqlStatement(execute, logo)).rejects.toThrow(
    "incompatible column: siteContent.logoImage"
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it("verifies every clause of the atomic order contacts ALTER before skipping it", async () => {
  const execute = vi
    .fn<Sql>()
    .mockResolvedValueOnce([
      { type: "json", nullable: "YES", defaultValue: null, extra: "" },
    ])
    .mockResolvedValueOnce([
      { type: "varchar(64)", nullable: "YES", defaultValue: null, extra: "" },
    ])
    .mockResolvedValueOnce([
      { nonUnique: 0, columnName: "requestKey", prefixLength: null },
    ]);
  await applyMysqlStatement(execute, contacts);
  expect(execute).toHaveBeenCalledTimes(3);

  execute
    .mockReset()
    .mockResolvedValueOnce([
      { type: "json", nullable: "YES", defaultValue: null, extra: "" },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  await expect(applyMysqlStatement(execute, contacts)).rejects.toThrow(
    "partially defined ALTER TABLE on orders"
  );
  expect(execute).toHaveBeenCalledTimes(3);
});

import { eq, type Table } from "drizzle-orm";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function insertAndReturn<T extends Table>(
  table: T,
  data: T["$inferInsert"]
): Promise<T["$inferSelect"]> {
  const db = getDb() as any;

  if (env.dbDialect === "sqlite") {
    const rows: T["$inferSelect"][] = await db
      .insert(table)
      .values(data)
      .returning();
    if (!rows[0]) {
      throw new Error(
        `Failed to insert into ${(table as any)[Symbol.for("drizzle:Name")] ?? "table"}`
      );
    }
    return rows[0];
  }

  // MySQL path: $returningId + второй SELECT
  const result = await db.insert(table).values(data).$returningId();
  const id = result[0]?.id;
  if (id === undefined || id === null) {
    throw new Error(
      `Failed to insert into ${(table as any)[Symbol.for("drizzle:Name")] ?? "table"}`
    );
  }
  const rows: T["$inferSelect"][] = await db
    .select()
    .from(table)
    .where(eq((table as any).id, id))
    .limit(1);
  if (!rows[0]) throw new Error("Row disappeared after insert");
  return rows[0];
}

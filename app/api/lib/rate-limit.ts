import { createHash } from "node:crypto";
import { securityTransaction } from "../queries/security-store";
export async function consumeRateLimit(
  key: string,
  limit: number,
  duration: number
) {
  return securityTransaction(async sql => {
    const now = Date.now();
    const hash = createHash("sha256").update(key).digest("hex");
    await sql("DELETE FROM apiRateLimits WHERE expiresAt <= ?", [now]);
    const insert =
      (await import("./env")).env.dbDialect === "mysql"
        ? "INSERT IGNORE"
        : "INSERT OR IGNORE";
    await sql(
      `${insert} INTO apiRateLimits (bucket, hits, expiresAt) VALUES (?, 0, ?)`,
      [hash, now + duration]
    );
    await sql("UPDATE apiRateLimits SET hits = hits + 1 WHERE bucket = ?", [
      hash,
    ]);
    const [row] = await sql("SELECT hits FROM apiRateLimits WHERE bucket = ?", [
      hash,
    ]);
    return Number(row.hits) <= limit;
  });
}

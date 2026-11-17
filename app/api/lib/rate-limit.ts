import { createHash } from "node:crypto";
import { env } from "./env";
import { securitySql, securityTransaction } from "../queries/security-store";
export async function consumeRateLimit(
  key: string,
  limit: number,
  duration: number
) {
  const hash = createHash("sha256").update(key).digest("hex");
  const purgeExpired = "DELETE FROM apiRateLimits WHERE expiresAt <= ?";
  // Commit the range delete before MySQL takes a bucket lock. A tRPC batch
  // can charge the same bucket from several concurrent transactions.
  if (env.dbDialect === "mysql") await securitySql(purgeExpired, [Date.now()]);

  return securityTransaction(async sql => {
    const now = Date.now();
    if (env.dbDialect === "mysql") {
      await sql(
        `INSERT INTO apiRateLimits (bucket, hits, expiresAt) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE
           hits = IF(expiresAt <= ?, 1, hits + 1),
           expiresAt = IF(expiresAt <= ?, ?, expiresAt)`,
        [hash, now + duration, now, now, now + duration]
      );
    } else {
      await sql(purgeExpired, [now]);
      await sql(
        "INSERT OR IGNORE INTO apiRateLimits (bucket, hits, expiresAt) VALUES (?, 0, ?)",
        [hash, now + duration]
      );
      await sql("UPDATE apiRateLimits SET hits = hits + 1 WHERE bucket = ?", [
        hash,
      ]);
    }
    const [row] = await sql("SELECT hits FROM apiRateLimits WHERE bucket = ?", [
      hash,
    ]);
    return Number(row.hits) <= limit;
  });
}

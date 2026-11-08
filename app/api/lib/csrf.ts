import { env } from "./env";
export function validMutationOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = [env.publicOrigin, env.devAdminOrigin].filter(Boolean);
  return (
    !!origin &&
    allowed.includes(origin) &&
    req.headers.get("sec-fetch-site") !== "cross-site"
  );
}

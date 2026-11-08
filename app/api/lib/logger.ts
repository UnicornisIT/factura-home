import { scrubCtx, scrubValue } from "./scrub";
function write(
  level: string,
  message: string,
  context?: Record<string, unknown>
) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message: scrubValue(message),
    context: scrubCtx(context),
  });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}
export const log = {
  info: (message: string, context?: Record<string, unknown>) =>
    write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    write("error", message, context),
};

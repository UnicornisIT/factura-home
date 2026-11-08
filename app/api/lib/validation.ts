import { z } from "zod";
function httpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
export const imageUrl = z
  .string()
  .max(2048)
  .refine(
    value =>
      value === "" ||
      (value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\")) ||
      httpsUrl(value),
    "Use a local image path or HTTPS URL"
  );
export const contactUrl = z
  .string()
  .max(500)
  .refine(value => value === "" || httpsUrl(value), "Use an HTTPS link");

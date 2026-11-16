import { z } from "zod";

export const contactMethods = ["telegram", "phone", "email"] as const;
export type ContactMethod = (typeof contactMethods)[number];
export const contactLabels: Record<ContactMethod, string> = {
  telegram: "Telegram",
  phone: "Телефон",
  email: "Email",
};

const telegram = z
  .string({ error: "Укажите имя пользователя Telegram" })
  .regex(
    /^@?[A-Za-z0-9_]{5,32}$/,
    "Введите имя пользователя из 5–32 латинских букв, цифр или знаков подчёркивания"
  )
  .transform(value => value.replace(/^@/, ""));

const phoneError = "Введите номер из 7–15 цифр, например +7 999 123-45-67";
const phone = z
  .string({ error: phoneError })
  .trim()
  .max(40, phoneError)
  .regex(/^\+?(?:\d|\(\d+\))(?: *(?:- *)?(?:\d|\(\d+\)))*$/, phoneError)
  .transform(value => value.replace(/[^+\d]/g, ""))
  .pipe(z.string().regex(/^(?=.*[1-9])(?:\+[1-9]|\d)\d{6,14}$/, phoneError));

const email = z
  .string({ error: "Укажите электронную почту" })
  .trim()
  .max(254, "Адрес слишком длинный")
  .pipe(z.email("Введите корректный адрес электронной почты"));

export const contactDetailsSchema = z
  .strictObject({
    telegram: telegram.optional(),
    phone: phone.optional(),
    email: email.optional(),
    preferred: z
      .enum(contactMethods, { error: "Выберите способ связи" })
      .optional(),
  })
  .transform((details, ctx) => {
    const selected = contactMethods.filter(
      method => details[method] !== undefined
    );
    if (selected.length === 0) {
      ctx.issues.push({
        code: "custom",
        input: details,
        message: "Выберите хотя бы один способ связи",
      });
      return z.NEVER;
    }
    const preferred =
      details.preferred ?? (selected.length === 1 ? selected[0] : undefined);
    if (!preferred || !selected.includes(preferred)) {
      ctx.issues.push({
        code: "custom",
        input: details,
        path: ["preferred"],
        message: "Укажите предпочтительный способ из выбранных",
      });
      return z.NEVER;
    }
    return { ...details, preferred };
  });

export type ContactDetails = z.output<typeof contactDetailsSchema>;

export const orderNameSchema = z
  .string()
  .trim()
  .min(2, "Введите имя из двух или более символов")
  .max(100, "Имя должно быть не длиннее 100 символов");
export const orderHoneypotSchema = z
  .literal("", { error: "Не удалось принять заказ" })
  .optional();

export function formatPhone(value: string) {
  const compact = value.trim();
  if (!/^\+?\d{7,15}$/.test(compact)) return value;
  const digits = compact.replace(/^\+/, "");
  const groups = digits.slice(0, -7).match(/\d{1,3}(?=(?:\d{3})*$)/g) ?? [];
  return (
    (compact.startsWith("+") ? "+" : "") +
    [...groups, digits.slice(-7, -4), digits.slice(-4)].join(" ")
  );
}

export function displayContact(method: ContactMethod, value: string) {
  if (method === "telegram") return `@${value}`;
  return method === "phone" ? formatPhone(value) : value;
}

export function parseLegacyContact(value: string): ContactDetails | undefined {
  const isDigitsOnly = /^\d+$/.test(value);
  for (const method of ["email", "phone", "telegram"] as const) {
    if (method === "telegram" && isDigitsOnly) continue;
    const result = contactDetailsSchema.safeParse({ [method]: value });
    if (result.success) return result.data;
  }
}

import type { OrderItemInput } from "../queries/orders";
import {
  contactLabels,
  contactMethods,
  displayContact,
} from "@contracts/order-contacts";
import {
  claimOrderNotification,
  finishOrderNotification,
  maxDeliveryAttempts,
  readEligibleDelivery,
} from "../queries/order-notifications";
import { env } from "./env";
import { log } from "./logger";

type TelegramResponse = {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

type SendResult =
  | { kind: "sent" | "chat_unavailable" | "rejected" }
  | { kind: "retry"; retryAfterMs?: number };

export const telegramTimeoutMs = 10_000;

export async function sendTelegramMessage(
  telegramId: number,
  message: string,
  orderUrl?: string
): Promise<SendResult> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(telegramTimeoutMs),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramId,
          text: message,
          protect_content: true,
          link_preview_options: { is_disabled: true },
          ...(orderUrl && {
            reply_markup: {
              inline_keyboard: [[{ text: "Открыть заказ", url: orderUrl }]],
            },
          }),
        }),
      }
    );
    const body = (await response
      .json()
      .catch(() => null)) as TelegramResponse | null;
    const code = response.ok ? body?.error_code : response.status;
    if (response.ok && body?.ok === true) return { kind: "sent" };
    if (code === 429) {
      const header = response.headers.get("retry-after");
      const values = [
        (body?.parameters?.retry_after ?? 0) * 1000,
        header ? Number(header) * 1000 || Date.parse(header) - Date.now() : 0,
      ];
      const delays = values.filter(
        value => Number.isFinite(value) && value > 0
      );
      return { kind: "retry", retryAfterMs: Math.max(0, ...delays) };
    }
    if (
      code === 403 ||
      (code === 400 &&
        /chat not found|user is deactivated/i.test(body?.description ?? ""))
    )
      return { kind: "chat_unavailable" };
    if (code !== undefined && code >= 400 && code < 500 && code !== 408)
      return { kind: "rejected" };
  } catch {
    // Fetch errors may include the request URL, which contains the bot token.
  }
  return { kind: "retry" };
}

type SavedOrder = NonNullable<Awaited<ReturnType<typeof readEligibleDelivery>>>;
const rubles = new Intl.NumberFormat("ru-RU");
const maxMessageLength = 4096;

function shorten(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

function orderMessage(order: SavedOrder) {
  const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();
  const contacts = order.contactDetails;
  const contactLines = contacts
    ? [
        "Способы связи:",
        ...contactMethods.flatMap(method => {
          const value = contacts[method];
          return value
            ? [`${contactLabels[method]}: ${displayContact(method, value)}`]
            : [];
        }),
        `\nПредпочтительный способ: ${contactLabels[contacts.preferred]}`,
      ].join("\n")
    : `Контакт: ${singleLine(order.contact)}`;
  const head = `Новый заказ #${order.id}\nПокупатель: ${singleLine(order.name)}\n${contactLines}\n\n`;
  const total = `\n\nИтого: ${rubles.format(order.total)} ₽`;
  const items = JSON.parse(order.items) as OrderItemInput[];
  const comment = order.comment?.trim();
  const commentLabel = "\nКомментарий: ";
  const details = items.map(
    item => ` × ${item.qty} — ${rubles.format(item.price)} ₽/шт.`
  );
  const nameBudget = Math.floor(
    (maxMessageLength -
      head.length -
      total.length -
      (comment ? commentLabel.length + 600 : 0) -
      items.length -
      details.reduce((sum, detail) => sum + detail.length, 0)) /
      Math.max(1, items.length)
  );
  const rows = items
    .map((item, i) => shorten(singleLine(item.name), nameBudget) + details[i])
    .join("\n");
  const base = head + rows + total;
  return comment
    ? base +
        commentLabel +
        shorten(comment, maxMessageLength - base.length - commentLabel.length)
    : base;
}

export async function deliverNextOrderNotification() {
  if (!env.telegramBotToken) return false;
  const delivery = await claimOrderNotification(Date.now());
  if (!delivery) return false;
  const order = await readEligibleDelivery(
    delivery,
    Date.now() + telegramTimeoutMs
  );
  if (!order) {
    // An expired or reclaimed lease must not send; an ineligible recipient is terminal.
    if (Date.now() + telegramTimeoutMs < delivery.leaseUntil)
      await finishOrderNotification(delivery, "cancelled");
    return true;
  }

  const message = orderMessage(order);
  if (Date.now() + telegramTimeoutMs >= delivery.leaseUntil) return true;
  const result = await sendTelegramMessage(
    order.telegramId,
    message,
    new URL("/admin/orders", env.publicOrigin).href
  );
  if (result.kind === "retry" && delivery.attempts < maxDeliveryAttempts) {
    const delay =
      15_000 * 2 ** (delivery.attempts - 1) + Math.floor(Math.random() * 5000);
    await finishOrderNotification(
      delivery,
      "pending",
      Date.now() + Math.max(delay, result.retryAfterMs ?? 0)
    );
  } else {
    const sent = result.kind === "sent";
    await finishOrderNotification(delivery, sent ? "sent" : "failed");
    if (!sent) log.warn("Order notification failed", { reason: result.kind });
  }
  return true;
}

export function startOrderNotificationWorker() {
  if (!env.telegramBotToken) return;
  const poll = async () => {
    let delay = 2000;
    try {
      if (await deliverNextOrderNotification()) delay = 100;
    } catch {
      log.error("Order notification worker failed");
    } finally {
      setTimeout(() => void poll(), delay).unref();
    }
  };
  void poll();
}

import { useRef, useState, type FormEvent } from "react";
import {
  contactDetailsSchema,
  contactMethods,
  formatPhone,
  orderHoneypotSchema,
  orderNameSchema,
  type ContactDetails,
  type ContactMethod,
} from "@contracts/order-contacts";

const fields = {
  telegram: {
    label: "Telegram",
    type: "text",
    example: "@ivanov",
    maxLength: 33,
  },
  phone: {
    label: "Телефон",
    type: "tel",
    example: "+7 999 123-45-67",
    maxLength: 40,
  },
  email: {
    label: "Электронная почта",
    type: "email",
    example: "ivan@example.ru",
    maxLength: 254,
  },
} as const;

type CheckoutData = {
  name: string;
  contactDetails: ContactDetails;
  comment: string;
  honeypot: "";
  items: { productId: number; qty: number }[];
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="checkout-error" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

function createRequestId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  // getRandomValues also works when the shop is reached over HTTP.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function CheckoutForm({
  items,
  pending,
  error,
  submitOrder,
}: {
  items: CheckoutData["items"];
  pending: boolean;
  error?: string;
  submitOrder: (data: CheckoutData & { requestId: string }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [contacts, setContacts] = useState<
    Partial<Record<ContactMethod, string>>
  >({});
  const [preferred, setPreferred] = useState<ContactMethod>();
  const [submitted, setSubmitted] = useState(false);
  const [honeypotError, setHoneypotError] = useState<string>();
  const submitting = useRef(false);
  const lastRequest = useRef<{ payload: string; id: string } | undefined>(
    undefined
  );
  const selected = contactMethods.filter(
    method => contacts[method] !== undefined
  );
  const nameResult = orderNameSchema.safeParse(name);
  const detailsResult = contactDetailsSchema.safeParse({
    ...contacts,
    preferred: selected.length === 1 ? selected[0] : preferred,
  });
  const nameError =
    submitted && !nameResult.success
      ? nameResult.error.issues[0].message
      : undefined;
  const detailsError = (field?: string) =>
    submitted && !detailsResult.success
      ? detailsResult.error.issues.find(issue => issue.path[0] === field)
          ?.message
      : undefined;
  const methodsError = detailsError();
  const preferredError = detailsError("preferred");

  function toggleMethod(method: ContactMethod, checked: boolean) {
    setContacts(previous => {
      const next = { ...previous };
      if (checked) next[method] = "";
      else delete next[method];
      return next;
    });
    if (!checked && preferred === method) setPreferred(undefined);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || pending) return;
    setSubmitted(true);
    const honeypot = orderHoneypotSchema.safeParse(
      new FormData(event.currentTarget).get("website")
    );
    setHoneypotError(honeypot.error?.issues[0].message);
    if (!nameResult.success || !detailsResult.success || !honeypot.success)
      return;

    const data = {
      name: nameResult.data,
      contactDetails: detailsResult.data,
      comment,
      honeypot: honeypot.data ?? "",
      items,
    };
    const payload = JSON.stringify(data);
    if (lastRequest.current?.payload !== payload)
      lastRequest.current = { payload, id: createRequestId() };

    submitting.current = true;
    try {
      await submitOrder({ ...data, requestId: lastRequest.current.id });
    } catch {
      // The mutation exposes the error beside the submit button.
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form className="cart-actions checkout-form" noValidate onSubmit={onSubmit}>
      <fieldset disabled={pending} className="checkout-fields">
        <div>
          <label htmlFor="checkout-name">Ваше имя</label>
          <input
            id="checkout-name"
            required
            autoComplete="name"
            maxLength={100}
            value={name}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "checkout-name-error" : undefined}
            onChange={event => setName(event.target.value)}
          />
          <FieldError id="checkout-name-error" message={nameError} />
        </div>
        <fieldset
          className="checkout-methods"
          aria-describedby={methodsError ? "checkout-methods-error" : undefined}
        >
          <legend>Способы связи</legend>
          <div className="checkout-options">
            {contactMethods.map(method => (
              <label key={method}>
                <input
                  type="checkbox"
                  checked={contacts[method] !== undefined}
                  onChange={event => toggleMethod(method, event.target.checked)}
                />
                {fields[method].label}
              </label>
            ))}
          </div>
          <FieldError id="checkout-methods-error" message={methodsError} />
          {selected.map(method => {
            const field = fields[method];
            const message = detailsError(method);
            const id = `checkout-${method}`;
            return (
              <div className="checkout-contact" key={method}>
                <label htmlFor={id}>{field.label}</label>
                <input
                  id={id}
                  type={field.type}
                  autoComplete={method === "telegram" ? "off" : field.type}
                  autoCapitalize={method === "telegram" ? "none" : undefined}
                  spellCheck={false}
                  required
                  placeholder={field.example}
                  maxLength={field.maxLength}
                  value={contacts[method]}
                  aria-invalid={!!message}
                  aria-describedby={message ? `${id}-error` : undefined}
                  onChange={event =>
                    setContacts({ ...contacts, [method]: event.target.value })
                  }
                  onBlur={
                    method === "phone"
                      ? event =>
                          setContacts({
                            ...contacts,
                            phone: formatPhone(event.target.value),
                          })
                      : undefined
                  }
                />
                <FieldError id={`${id}-error`} message={message} />
              </div>
            );
          })}
        </fieldset>
        {selected.length > 1 && (
          <fieldset
            className="checkout-methods checkout-contact"
            aria-describedby={
              preferredError ? "checkout-preferred-error" : undefined
            }
          >
            <legend>Предпочтительный способ связи</legend>
            <div className="checkout-options">
              {selected.map(method => (
                <label key={method}>
                  <input
                    type="radio"
                    name="preferred"
                    value={method}
                    checked={preferred === method}
                    onChange={() => setPreferred(method)}
                  />
                  {fields[method].label}
                </label>
              ))}
            </div>
            <FieldError
              id="checkout-preferred-error"
              message={preferredError}
            />
          </fieldset>
        )}
        <label>
          Комментарий
          <textarea
            maxLength={2000}
            value={comment}
            onChange={event => setComment(event.target.value)}
          />
        </label>
        <div className="checkout-website" aria-hidden="true">
          <label>
            Сайт
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      </fieldset>
      <FieldError id="checkout-spam-error" message={honeypotError} />
      {error && <p role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Отправка…" : "Оформить заказ"}
      </button>
    </form>
  );
}

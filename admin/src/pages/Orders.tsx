import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { OrderTelegramSettings } from "@/components/OrderTelegramSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  contactLabels,
  contactMethods,
  displayContact,
  parseLegacyContact,
  type ContactDetails,
  type ContactMethod,
} from "@contracts/order-contacts";

const STATUS_META: Record<
  string,
  { label: string; variant: "warning" | "info" | "brand" | "success" }
> = {
  new: { label: "Новый", variant: "warning" },
  in_progress: { label: "В работе", variant: "info" },
  shipped: { label: "Отправлен", variant: "brand" },
  done: { label: "Выполнен", variant: "success" },
};

const NEXT: Record<string, keyof typeof STATUS_META> = {
  new: "in_progress",
  in_progress: "shipped",
  shipped: "done",
};

type StatusFilter = "all" | keyof typeof STATUS_META;

function contactHref(method: ContactMethod, value: string) {
  switch (method) {
    case "telegram":
      return `https://t.me/${value}`;
    case "phone":
      return `tel:${value}`;
    case "email":
      return `mailto:${encodeURIComponent(value).replace("%40", "@")}`;
  }
}

function OrderContacts({
  contact,
  details,
}: {
  contact: string;
  details?: ContactDetails | null;
}) {
  if (!details) {
    const legacy = parseLegacyContact(contact.trim());
    const method = legacy?.preferred;
    const value = method && legacy[method];
    const legacyTelegram = /^@([A-Za-z0-9_]{1,32})$/.exec(contact.trim());
    const href = legacyTelegram
      ? contactHref("telegram", legacyTelegram[1])
      : method && method !== "telegram" && value
        ? contactHref(method, value)
        : undefined;
    return (
      <div className="break-words text-sm text-slate-600">
        Контакт:{" "}
        {href ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal break-all"
          >
            <a
              href={href}
              target={legacyTelegram ? "_blank" : undefined}
              rel={legacyTelegram ? "noopener" : undefined}
            >
              {contact}
            </a>
          </Button>
        ) : (
          <span>{contact}</span>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-2 text-sm" aria-label="Способы связи">
      <h3 className="font-medium text-slate-700">Способы связи</h3>
      <dl className="space-y-2">
        {contactMethods.map((method) => {
          const value = details[method];
          if (!value) return null;
          return (
            <div
              key={method}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <dt className="text-slate-600">{contactLabels[method]}</dt>
              <dd className="min-w-0 max-w-full">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-auto max-w-full whitespace-normal break-all"
                >
                  <a
                    href={contactHref(method, value)}
                    target={method === "telegram" ? "_blank" : undefined}
                    rel={method === "telegram" ? "noopener" : undefined}
                  >
                    {displayContact(method, value)}
                  </a>
                </Button>
              </dd>
              {method === details.preferred && (
                <dd>
                  <Badge variant="brand">Предпочтительный</Badge>
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export default function Orders() {
  const utils = trpc.useUtils();
  const { data: orders } = trpc.orders.list.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.orders.newCount.invalidate();
    },
  });
  const deleteOrder = trpc.orders.delete.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate();
      utils.orders.newCount.invalidate();
    },
  });

  const filtered = useMemo(() => {
    if (filter === "all") return orders ?? [];
    return (orders ?? []).filter((o) => o.status === filter);
  }, [orders, filter]);

  return (
    <AdminLayout
      title="Заказы"
      description={`${orders?.length ?? 0} всего`}
      actions={
        <div className="w-full sm:w-44">
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as StatusFilter)}
          >
            <SelectTrigger aria-label="Статус заказа">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="new">Новые</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="shipped">Отправлены</SelectItem>
              <SelectItem value="done">Выполнены</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div className="space-y-3">
        <OrderTelegramSettings />
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-slate-500">
              Заказов с этим фильтром нет
            </CardContent>
          </Card>
        )}

        {filtered.map((o) => {
          const items: { name: string; price: number; qty: number }[] = (() => {
            try {
              return JSON.parse(o.items);
            } catch {
              return [];
            }
          })();
          const st = STATUS_META[o.status] ?? STATUS_META.new;
          const next = NEXT[o.status];
          const isOpen = expanded === o.id;

          return (
            <Card key={o.id}>
              <CardContent className="p-4">
                <Button
                  type="button"
                  variant="outline"
                  aria-expanded={isOpen}
                  className="h-auto w-full flex-wrap justify-between gap-x-4 gap-y-2 whitespace-normal p-2 text-left sm:flex-nowrap"
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-slate-900">
                        #{o.id} · {o.name}
                      </span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {new Date(o.createdAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  <span className="max-w-full text-right">
                    <span className="block font-semibold">
                      {o.total.toLocaleString("ru-RU")} ₽
                    </span>
                    <span className="block text-xs text-slate-500">
                      {items.length} позиций
                    </span>
                  </span>
                </Button>

                {/* Развернутый контент */}
                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    <div className="text-sm">
                      {items.map((it, i) => (
                        <div
                          key={i}
                          className="flex justify-between gap-2 border-b border-dashed border-slate-100 py-1 last:border-0"
                        >
                          <span>
                            {it.name}
                            {it.qty > 1 ? ` × ${it.qty}` : ""}
                          </span>
                          <span className="shrink-0 text-slate-700">
                            {(it.price * it.qty).toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 font-semibold">
                        <span>Итого</span>
                        <span>{o.total.toLocaleString("ru-RU")} ₽</span>
                      </div>
                    </div>

                    <OrderContacts
                      contact={o.contact}
                      details={o.contactDetails}
                    />
                    {o.comment && (
                      <div className="text-sm text-slate-600">
                        Комментарий: {o.comment}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      {next && (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateStatus.mutate({
                              id: o.id,
                              status: next as
                                "new" | "in_progress" | "shipped" | "done",
                            })
                          }
                        >
                          → {STATUS_META[next].label}
                        </Button>
                      )}
                      {o.status !== "new" && o.status !== "done" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateStatus.mutate({ id: o.id, status: "new" })
                          }
                        >
                          Вернуть в новые
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn("text-red-700 hover:bg-red-50")}
                        onClick={() => {
                          if (confirm(`Удалить заказ #${o.id}?`))
                            deleteOrder.mutate({ id: o.id });
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AdminLayout>
  );
}

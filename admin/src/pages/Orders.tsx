import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
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
        <div className="w-44">
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as StatusFilter)}
          >
            <SelectTrigger>
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
                {/* Шапка заказа */}
                <button
                  className="w-full flex items-center justify-between gap-4 text-left"
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-slate-900">
                        #{o.id} · {o.name}
                      </span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(o.createdAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">
                      {o.total.toLocaleString("ru-RU")} ₽
                    </div>
                    <div className="text-xs text-slate-500">
                      {items.length} позиций
                    </div>
                  </div>
                </button>

                {/* Развернутый контент */}
                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    <div className="text-sm">
                      {items.map((it, i) => (
                        <div
                          key={i}
                          className="flex justify-between py-1 border-b border-dashed border-slate-100 last:border-0"
                        >
                          <span>
                            {it.name}
                            {it.qty > 1 ? ` × ${it.qty}` : ""}
                          </span>
                          <span className="text-slate-700">
                            {(it.price * it.qty).toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 font-semibold">
                        <span>Итого</span>
                        <span>{o.total.toLocaleString("ru-RU")} ₽</span>
                      </div>
                    </div>

                    <div className="text-sm text-slate-600">
                      Контакт:{" "}
                      <a
                        href={
                          o.contact.includes("@") &&
                          !o.contact.startsWith("http")
                            ? `https://t.me/${o.contact.replace("@", "")}`
                            : undefined
                        }
                        className="text-[#5C2A2A] font-medium"
                        target="_blank"
                        rel="noopener"
                      >
                        {o.contact}
                      </a>
                    </div>
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

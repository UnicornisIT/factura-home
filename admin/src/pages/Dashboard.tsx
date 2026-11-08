import { useMemo } from "react";
import { Link } from "react-router";
import {
  ShoppingCart,
  Package,
  TrendingUp,
  Receipt,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<
  string,
  {
    label: string;
    variant: "default" | "brand" | "success" | "warning" | "info" | "danger";
  }
> = {
  new: { label: "Новый", variant: "warning" },
  in_progress: { label: "В работе", variant: "info" },
  shipped: { label: "Отправлен", variant: "brand" },
  done: { label: "Выполнен", variant: "success" },
};

export default function Dashboard() {
  const { data: orders } = trpc.orders.list.useQuery();
  const { data: products } = trpc.products.listAll.useQuery();
  const { data: newOrdersCount } = trpc.orders.newCount.useQuery();

  // Считаем статистику на клиенте — данных немного, отдельные tRPC-endpoint'ы
  // для этого были бы избыточны.
  const stats = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentOrders = (orders ?? []).filter(
      (o) => new Date(o.createdAt).getTime() >= thirtyDaysAgo,
    );
    const revenue = recentOrders.reduce((s, o) => s + o.total, 0);
    const avgCheck = recentOrders.length
      ? Math.round(revenue / recentOrders.length)
      : 0;
    const activeProducts = (products ?? []).filter((p) => p.isActive).length;
    return {
      revenue,
      avgCheck,
      activeProducts,
      recentCount: recentOrders.length,
    };
  }, [orders, products]);

  // График заказов за последние 14 дней
  const chartData = useMemo(() => {
    const days: {
      date: string;
      ts: number;
      orders: number;
      revenue: number;
    }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push({
        date: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
        ts: d.getTime(),
        orders: 0,
        revenue: 0,
      });
    }
    for (const o of orders ?? []) {
      const t = new Date(o.createdAt).getTime();
      const day = days.find((d) => t >= d.ts && t < d.ts + 24 * 60 * 60 * 1000);
      if (day) {
        day.orders += 1;
        day.revenue += o.total;
      }
    }
    return days;
  }, [orders]);

  const lastOrders = (orders ?? []).slice(0, 5);
  const topProducts = useMemo(() => {
    const counts = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();
    for (const o of orders ?? []) {
      try {
        const items: { name: string; price: number; qty: number }[] =
          JSON.parse(o.items);
        for (const it of items) {
          const cur = counts.get(it.name) ?? {
            name: it.name,
            qty: 0,
            revenue: 0,
          };
          cur.qty += it.qty;
          cur.revenue += it.price * it.qty;
          counts.set(it.name, cur);
        }
      } catch {
        /* ignore */
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [orders]);

  return (
    <AdminLayout
      title="Дэшборд"
      description="Сводка по магазину за последние 30 дней"
    >
      {/* KPI-карточки */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<ShoppingCart className="h-5 w-5" />}
          label="Новых заказов"
          value={String(newOrdersCount ?? 0)}
          accent="text-amber-600"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Выручка за 30 дней"
          value={`${stats.revenue.toLocaleString("ru-RU")} ₽`}
          accent="text-[#5C2A2A]"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Средний чек"
          value={`${stats.avgCheck.toLocaleString("ru-RU")} ₽`}
          accent="text-blue-600"
        />
        <StatCard
          icon={<Package className="h-5 w-5" />}
          label="Активных товаров"
          value={String(stats.activeProducts)}
          accent="text-green-700"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* График заказов */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Заказы за 14 дней</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ left: -16, right: 8, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#5C2A2A"
                        stopOpacity={0.35}
                      />
                      <stop offset="100%" stopColor="#5C2A2A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#0f172a", fontWeight: 600 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="orders"
                    stroke="#5C2A2A"
                    strokeWidth={2}
                    fill="url(#ordersGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Топ-товары */}
        <Card>
          <CardHeader>
            <CardTitle>Топ-товары</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topProducts.length === 0 ? (
              <p className="text-sm text-slate-500 px-5 py-8 text-center">
                Пока нет заказов с товарами
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {topProducts.map((p, i) => (
                  <li
                    key={i}
                    className="px-5 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {p.qty} продано
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-[#5C2A2A] shrink-0">
                      {p.revenue.toLocaleString("ru-RU")} ₽
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Последние заказы */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Последние заказы</CardTitle>
          <Link
            to="/orders"
            className="text-xs text-[#5C2A2A] hover:underline inline-flex items-center gap-1"
          >
            Все заказы <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {lastOrders.length === 0 ? (
            <p className="text-sm text-slate-500 px-5 py-8 text-center">
              Заказов пока нет
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lastOrders.map((o) => {
                const st = STATUS_LABELS[o.status] ?? STATUS_LABELS.new;
                return (
                  <li
                    key={o.id}
                    className="px-5 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        #{o.id} · {o.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="text-sm font-semibold">
                        {o.total.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={`shrink-0 ${accent}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500 uppercase tracking-wide">
            {label}
          </div>
          <div className="text-xl font-semibold text-slate-900 truncate">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";

// В dev витрина на :3000 (отдельный origin), в production — тот же origin.
const SHOP_ORIGIN = import.meta.env.DEV ? "http://localhost:3000" : "";

const DEVICES = [
  { key: "desktop", label: "Компьютер", icon: Monitor, width: null },
  { key: "tablet", label: "Планшет", icon: Tablet, width: 820 },
  { key: "mobile", label: "Телефон", icon: Smartphone, width: 390 },
] as const;

type DeviceKey = (typeof DEVICES)[number]["key"];

export default function Preview() {
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [nonce, setNonce] = useState(0);
  const active = DEVICES.find((item) => item.key === device)!;

  return (
    <AdminLayout
      title="Предпросмотр"
      description="Живая витрина магазина. Изменения из конструктора и дизайна видны после обновления рамки."
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-200 p-0.5">
            {DEVICES.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.key}
                  size="sm"
                  variant={device === item.key ? "default" : "ghost"}
                  className="gap-1.5"
                  onClick={() => setDevice(item.key)}
                  aria-pressed={device === item.key}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            onClick={() => setNonce((value) => value + 1)}
            className="gap-1.5"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
          <a href={`${SHOP_ORIGIN}/`} target="_blank" rel="noopener">
            <Button variant="outline">Открыть в новой вкладке</Button>
          </a>
        </div>
      }
    >
      <div className="flex justify-center rounded-md bg-slate-100 p-4">
        <iframe
          key={`${device}-${nonce}`}
          src={`${SHOP_ORIGIN}/`}
          title="Предпросмотр витрины"
          className="h-[75vh] rounded-lg border border-slate-300 bg-white shadow-sm transition-all"
          style={{
            width: active.width ? `${active.width}px` : "100%",
            maxWidth: "100%",
          }}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Предпросмотр показывает опубликованное содержимое: сохраните изменения в
        конструкторе или дизайне и нажмите «Обновить».
      </p>
    </AdminLayout>
  );
}

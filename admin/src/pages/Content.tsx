import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { ImageUpload } from "@/components/ImageUpload";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NavItem } from "@contracts/design";
import { MAX_NAV_ITEMS } from "@contracts/design";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

type ContentForm = {
  shopName: string;
  logoImage: string;
  showShopName: boolean;
  footerCta: string;
  footerText: string;
  telegram: string;
  whatsapp: string;
  vk: string;
  email: string;
  navItems: NavItem[];
};

const ANCHOR_OPTIONS = [
  { value: "#catalog", label: "Каталог" },
  { value: "#products", label: "Товары" },
  { value: "#about", label: "О мастерской" },
  { value: "#delivery", label: "Доставка" },
  { value: "#contacts", label: "Контакты" },
];

export default function Content() {
  const { data: content } = trpc.content.get.useQuery();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<ContentForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (content && !form) {
      setForm({
        shopName: content.shopName,
        logoImage: content.logoImage ?? "",
        showShopName: content.showShopName !== false,
        footerCta: content.footerCta,
        footerText: content.footerText ?? "",
        telegram: content.telegram ?? "",
        whatsapp: content.whatsapp ?? "",
        vk: content.vk ?? "",
        email: content.email ?? "",
        navItems: content.navItems ?? [],
      });
    }
  }, [content, form]);

  const updateContent = trpc.content.update.useMutation({
    onSuccess: async () => {
      await utils.content.get.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const set = <K extends keyof ContentForm>(key: K, value: ContentForm[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const setNav = (navItems: NavItem[]) => set("navItems", navItems);

  const moveNav = (index: number, delta: number) => {
    if (!form) return;
    const target = index + delta;
    if (target < 0 || target >= form.navItems.length) return;
    const next = [...form.navItems];
    [next[index], next[target]] = [next[target], next[index]];
    setNav(next);
  };

  return (
    <AdminLayout
      title="Тексты и контакты"
      description="Название и логотип, меню шапки, футер и контактные ссылки. Тексты разделов страницы настраиваются в «Конструкторе»."
      actions={
        <Button
          onClick={() => form && updateContent.mutate(form)}
          disabled={!form || updateContent.isPending}
        >
          {updateContent.isPending ? "Сохранение…" : "Сохранить всё"}
        </Button>
      }
    >
      {saved && (
        <div className="mb-4 px-3 py-2 rounded-md bg-green-50 border border-green-200 text-sm text-green-800">
          Тексты сохранены
        </div>
      )}
      {updateContent.error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
          {updateContent.error.message}
        </div>
      )}

      {!form ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-500">
            Загрузка…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Шапка сайта</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Название магазина</Label>
                <Input
                  value={form.shopName}
                  onChange={(e) => set("shopName", e.target.value)}
                />
              </div>
              <div>
                <Label>Логотип (необязательно)</Label>
                <Input
                  value={form.logoImage}
                  onChange={(e) => set("logoImage", e.target.value)}
                  placeholder="/uploads/….webp"
                />
                <ImageUpload
                  onUpload={(logoImage) => set("logoImage", logoImage)}
                />
                {form.logoImage && (
                  <img
                    src={form.logoImage}
                    alt=""
                    className="mt-2 h-14 max-w-40 rounded object-contain border border-slate-200 bg-white p-1"
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showShopName}
                  onChange={(e) => set("showShopName", e.target.checked)}
                  className="h-4 w-4"
                />
                Показывать название рядом с логотипом
              </label>

              <div>
                <Label>Пункты меню</Label>
                <p className="text-xs text-slate-500 mb-2">
                  Пустой список — меню строится автоматически из блоков
                  страницы. Ссылка ведёт на якорь секции лендинга.
                </p>
                <div className="space-y-2">
                  {form.navItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-md border border-slate-200 p-2"
                    >
                      <input
                        type="checkbox"
                        checked={item.visible}
                        onChange={(e) =>
                          setNav(
                            form.navItems.map((v, i) =>
                              i === index
                                ? { ...v, visible: e.target.checked }
                                : v,
                            ),
                          )
                        }
                        className="h-4 w-4 shrink-0"
                        aria-label="Показывать пункт"
                      />
                      <Input
                        value={item.label}
                        onChange={(e) =>
                          setNav(
                            form.navItems.map((v, i) =>
                              i === index
                                ? { ...v, label: e.target.value.slice(0, 40) }
                                : v,
                            ),
                          )
                        }
                        placeholder="Подпись"
                        className="flex-1"
                      />
                      <select
                        value={
                          ANCHOR_OPTIONS.some((o) => o.value === item.anchor)
                            ? item.anchor
                            : ""
                        }
                        onChange={(e) =>
                          setNav(
                            form.navItems.map((v, i) =>
                              i === index
                                ? { ...v, anchor: e.target.value }
                                : v,
                            ),
                          )
                        }
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                        aria-label="Раздел"
                      >
                        <option value="" disabled>
                          Раздел…
                        </option>
                        {ANCHOR_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label} ({option.value})
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => moveNav(index, -1)}
                        disabled={index === 0}
                        aria-label="Переместить выше"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => moveNav(index, 1)}
                        disabled={index === form.navItems.length - 1}
                        aria-label="Переместить ниже"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-600 hover:text-red-700"
                        onClick={() =>
                          setNav(form.navItems.filter((_, i) => i !== index))
                        }
                        aria-label="Удалить пункт"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={form.navItems.length >= MAX_NAV_ITEMS}
                  onClick={() =>
                    setNav([
                      ...form.navItems,
                      { label: "", anchor: "#catalog", visible: true },
                    ])
                  }
                >
                  + Добавить пункт
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Футер и контакты</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Призыв в футере</Label>
                <Input
                  value={form.footerCta}
                  onChange={(e) => set("footerCta", e.target.value)}
                />
              </div>
              <div>
                <Label>Дополнительный текст футера (необязательно)</Label>
                <Input
                  value={form.footerText}
                  onChange={(e) => set("footerText", e.target.value)}
                  placeholder="ИП Иванова · ОГРНИП 0000000000"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Telegram (ссылка)</Label>
                  <Input
                    value={form.telegram}
                    onChange={(e) => set("telegram", e.target.value)}
                    placeholder="https://t.me/username"
                  />
                </div>
                <div>
                  <Label>WhatsApp (ссылка)</Label>
                  <Input
                    value={form.whatsapp}
                    onChange={(e) => set("whatsapp", e.target.value)}
                    placeholder="https://wa.me/79001234567"
                  />
                </div>
                <div>
                  <Label>ВКонтакте (ссылка)</Label>
                  <Input
                    value={form.vk}
                    onChange={(e) => set("vk", e.target.value)}
                    placeholder="https://vk.com/club123"
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Пустые ссылки не показываются на сайте — ни в блоке «Контакты»,
                ни в футере.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}

import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ContentForm = {
  shopName: string;
  footerCta: string;
  telegram: string;
  whatsapp: string;
  email: string;
};

export default function Content() {
  const { data: content } = trpc.content.get.useQuery();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<ContentForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (content && !form) {
      setForm({
        shopName: content.shopName,
        footerCta: content.footerCta,
        telegram: content.telegram ?? "",
        whatsapp: content.whatsapp ?? "",
        email: content.email ?? "",
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

  return (
    <AdminLayout
      title="Тексты и контакты"
      description="Название магазина, призыв в футере и контактные ссылки. Тексты разделов страницы настраиваются в «Конструкторе»."
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
              <CardTitle>Общее</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Название магазина</Label>
                <Input
                  value={form.shopName}
                  onChange={(e) => set("shopName", e.target.value)}
                />
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
              <div className="grid sm:grid-cols-3 gap-3">
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
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}

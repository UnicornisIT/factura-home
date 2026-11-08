import { ImageUpload } from "@/components/ImageUpload";
import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ContentForm = {
  shopName: string;
  heroTitle: string;
  heroText: string;
  aboutTitle: string;
  aboutText: string;
  aboutImage: string;
  deliveryTitle: string;
  deliveryText: string;
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
        heroTitle: content.heroTitle,
        heroText: content.heroText,
        aboutTitle: content.aboutTitle,
        aboutText: content.aboutText,
        aboutImage: content.aboutImage ?? "",
        deliveryTitle: content.deliveryTitle,
        deliveryText: content.deliveryText,
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
      description="Тексты магазина: главный экран, о мастерской, доставка, футер"
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
              <div>
                <Label>Заголовок первого экрана</Label>
                <Input
                  value={form.heroTitle}
                  onChange={(e) => set("heroTitle", e.target.value)}
                />
              </div>
              <div>
                <Label>Текст первого экрана</Label>
                <Textarea
                  rows={3}
                  value={form.heroText}
                  onChange={(e) => set("heroText", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>О мастерской</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Заголовок</Label>
                <Input
                  value={form.aboutTitle}
                  onChange={(e) => set("aboutTitle", e.target.value)}
                />
              </div>
              <div>
                <Label>Текст (абзацы через пустую строку)</Label>
                <Textarea
                  rows={6}
                  value={form.aboutText}
                  onChange={(e) => set("aboutText", e.target.value)}
                />
              </div>
              <div>
                <Label>Ссылка на фото мастерской</Label>
                <Input
                  value={form.aboutImage}
                  onChange={(e) => set("aboutImage", e.target.value)}
                />
                <ImageUpload onUpload={(url) => set("aboutImage", url)} />
                {form.aboutImage && (
                  <img
                    src={form.aboutImage}
                    alt=""
                    className="mt-2 h-24 rounded border border-slate-200 object-cover"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Доставка</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Заголовок</Label>
                <Input
                  value={form.deliveryTitle}
                  onChange={(e) => set("deliveryTitle", e.target.value)}
                />
              </div>
              <div>
                <Label>Текст</Label>
                <Textarea
                  rows={3}
                  value={form.deliveryText}
                  onChange={(e) => set("deliveryText", e.target.value)}
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

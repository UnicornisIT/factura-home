import { ImageUpload } from "@/components/ImageUpload";
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Collection } from "@db/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

type CollForm = {
  id?: number;
  slug: string;
  title: string;
  coverImage: string;
  sortOrder: number;
};

const EMPTY: CollForm = { slug: "", title: "", coverImage: "", sortOrder: 1 };

export default function Collections() {
  const utils = trpc.useUtils();
  const { data: collections } = trpc.collections.list.useQuery();

  const [form, setForm] = useState<CollForm | null>(null);
  const [open, setOpen] = useState(false);

  const invalidate = () => utils.collections.list.invalidate();
  const createCollection = trpc.collections.create.useMutation({
    onSuccess: () => finishSave(),
  });
  const updateCollection = trpc.collections.update.useMutation({
    onSuccess: () => finishSave(),
  });

  const finishSave = async () => {
    await invalidate();
    setOpen(false);
    setForm(null);
  };

  const startCreate = () => {
    setForm({ ...EMPTY, sortOrder: (collections?.length ?? 0) + 1 });
    setOpen(true);
  };

  const startEdit = (c: Collection) => {
    setForm({
      id: c.id,
      slug: c.slug,
      title: c.title,
      coverImage: c.coverImage ?? "",
      sortOrder: c.sortOrder ?? 0,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!form || !form.title.trim() || !form.slug.trim()) return;
    const payload = {
      slug: form.slug,
      title: form.title,
      coverImage: form.coverImage || null,
      sortOrder: form.sortOrder,
    };
    if (form.id) {
      updateCollection.mutate({ id: form.id, ...payload });
    } else {
      createCollection.mutate(payload);
    }
  };

  return (
    <AdminLayout
      title="Коллекции"
      description={`${collections?.length ?? 0} коллекций в каталоге`}
      actions={<Button onClick={startCreate}>+ Добавить коллекцию</Button>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(collections ?? []).map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="h-32 bg-slate-100 overflow-hidden">
              {c.coverImage && (
                <img
                  src={c.coverImage}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="p-4 space-y-1">
              <div className="font-semibold text-base">{c.title}</div>
              <div className="text-xs text-slate-500">/{c.slug}</div>
              <div className="pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startEdit(c)}
                >
                  Изменить
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {(collections ?? []).length === 0 && (
          <Card className="col-span-full p-8 text-center text-slate-500">
            Коллекций пока нет — добавьте первую.
          </Card>
        )}
      </div>

      <p className="text-xs text-slate-500 mt-6">
        Удаление коллекции недоступно, пока в ней есть товары — сначала
        перенесите или удалите товары.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Редактировать коллекцию" : "Новая коллекция"}
            </DialogTitle>
            <DialogDescription>
              Slug — латиница и дефис, используется в URL.
            </DialogDescription>
          </DialogHeader>

          {form && (
            <div className="grid gap-4">
              <div>
                <Label>Название *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Весенняя коллекция"
                />
              </div>
              <div>
                <Label>Slug (латиницей) *</Label>
                <Input
                  value={form.slug}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, ""),
                    })
                  }
                  placeholder="spring"
                />
              </div>
              <div>
                <Label>Ссылка на обложку</Label>
                <Input
                  value={form.coverImage}
                  onChange={(e) =>
                    setForm({ ...form, coverImage: e.target.value })
                  }
                  placeholder="/img/cover-winter.png"
                />
                <ImageUpload
                  onUpload={(coverImage) =>
                    setForm((current) =>
                      current ? { ...current, coverImage } : current,
                    )
                  }
                />
                {form.coverImage && (
                  <img
                    src={form.coverImage}
                    alt=""
                    className="mt-2 h-20 w-32 rounded object-cover border border-slate-200"
                  />
                )}
              </div>
              <div className="max-w-40">
                <Label>Порядок</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )}

          {(createCollection.error || updateCollection.error) && (
            <p role="alert" className="text-sm text-red-700">
              {(createCollection.error || updateCollection.error)?.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submit}
              disabled={
                !form?.title.trim() ||
                !form?.slug.trim() ||
                createCollection.isPending ||
                updateCollection.isPending
              }
            >
              {form?.id ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

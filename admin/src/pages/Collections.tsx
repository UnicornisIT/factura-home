import { ImageUpload } from "@/components/ImageUpload";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router";
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
  description: string;
  coverImage: string;
  sortOrder: number;
};

const EMPTY: CollForm = {
  slug: "",
  title: "",
  description: "",
  coverImage: "",
  sortOrder: 1,
};

export default function Collections() {
  const utils = trpc.useUtils();
  const {
    data: collections,
    isPending,
    isFetching,
    isError,
  } = trpc.collections.listWithProductCounts.useQuery();

  const [form, setForm] = useState<CollForm | null>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Collection | null>(null);

  const invalidate = () => utils.collections.invalidate();
  const createCollection = trpc.collections.create.useMutation({
    onSuccess: () => finishSave(),
  });
  const updateCollection = trpc.collections.update.useMutation({
    onSuccess: () => finishSave(),
  });
  const deleteCollection = trpc.collections.delete.useMutation({
    onSuccess: async () => {
      await invalidate();
      setPendingDelete(null);
    },
    onError: async () => {
      await invalidate();
    },
  });
  const countsReady = !isFetching && !isPending && !isError;
  const canConfirmDelete =
    countsReady &&
    collections?.find((c) => c.id === pendingDelete?.id)?.productCount === 0;
  const deleteError = deleteCollection.error;

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
      description: c.description ?? "",
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
      description: form.description,
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
      description={
        collections ? `${collections.length} коллекций в каталоге` : undefined
      }
      actions={<Button onClick={startCreate}>+ Добавить коллекцию</Button>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(collections ?? []).map((c) => (
          <Card key={c.id} className="overflow-hidden [overflow-wrap:anywhere]">
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
              {c.description && (
                <div className="text-xs text-slate-600 line-clamp-2">
                  {c.description}
                </div>
              )}
              <div className="pt-2">
                {isError ? (
                  <p className="text-xs text-slate-500">Счётчик недоступен</p>
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/products?collectionId=${c.id}`}>
                      {c.productCount === 0
                        ? "0 товаров"
                        : `Товаров: ${c.productCount}`}
                    </Link>
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-3 [&>a]:min-h-10 sm:[&>a]:min-h-0 [&>button]:min-h-10 sm:[&>button]:min-h-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startEdit(c)}
                >
                  Изменить
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    !countsReady ||
                    c.productCount > 0 ||
                    deleteCollection.isPending
                  }
                  onClick={() => {
                    deleteCollection.reset();
                    setPendingDelete(c);
                  }}
                >
                  Удалить
                </Button>
              </div>
              {!isError && c.productCount > 0 && (
                <p className="text-xs text-slate-500">
                  Удаление недоступно, пока в коллекции есть товары.
                </p>
              )}
            </div>
          </Card>
        ))}
        {isPending && (
          <Card
            role="status"
            className="col-span-full p-8 text-center text-slate-500"
          >
            Загрузка коллекций и счётчиков…
          </Card>
        )}
        {isError && (
          <Card
            role="alert"
            className="col-span-full p-8 text-center text-red-700"
          >
            Не удалось загрузить коллекции и счётчики. Удаление недоступно.
          </Card>
        )}
        {!isPending && !isError && collections?.length === 0 && (
          <Card className="col-span-full p-8 text-center text-slate-500">
            Коллекций пока нет — добавьте первую.
          </Card>
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleteCollection.isPending) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить коллекцию?</DialogTitle>
            <DialogDescription>
              Вы действительно хотите удалить коллекцию «{pendingDelete?.title}
              »? Это действие нельзя отменить. Коллекция будет удалена из
              каталога.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-red-700">
              {deleteError.data?.code === "CONFLICT" ||
              deleteError.data?.code === "NOT_FOUND"
                ? deleteError.message
                : "Не удалось удалить коллекцию. Попробуйте ещё раз."}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteCollection.isPending}
              onClick={() => setPendingDelete(null)}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={!canConfirmDelete || deleteCollection.isPending}
              onClick={() => {
                if (
                  pendingDelete &&
                  canConfirmDelete &&
                  !deleteCollection.isPending
                ) {
                  deleteCollection.mutate({ id: pendingDelete.id });
                }
              }}
            >
              {deleteCollection.isPending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {deleteCollection.isPending ? "Удаление…" : "Удалить коллекцию"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <Label>Описание (необязательно)</Label>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Тёплые свечи и подсвечники для уютных вечеров"
                  maxLength={1000}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Показывается на карточке категории в каталоге и под заголовком
                  при выборе фильтра товаров.
                </p>
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
                  onBusyChange={setUploading}
                  onUpload={(coverImage) =>
                    setForm((current) =>
                      current ? { ...current, coverImage } : current,
                    )
                  }
                />
                {uploading && (
                  <p className="mt-1 text-xs text-slate-500">
                    Идёт загрузка фото — сохранение станет доступно после её
                    завершения.
                  </p>
                )}
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
                uploading ||
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

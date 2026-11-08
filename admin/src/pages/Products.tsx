import { ImageUpload } from "@/components/ImageUpload";
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@db/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

type ProductForm = {
  id?: number;
  collectionId: number;
  name: string;
  material: string;
  price: number;
  image: string;
  isActive: boolean;
  sortOrder: number;
};

const EMPTY_FORM: ProductForm = {
  collectionId: 0,
  name: "",
  material: "",
  price: 650,
  image: "",
  isActive: true,
  sortOrder: 0,
};

export default function Products() {
  const utils = trpc.useUtils();
  const { data: collections } = trpc.collections.list.useQuery();
  const { data: products } = trpc.products.listAll.useQuery();

  const [editing, setEditing] = useState<ProductForm | null>(null);
  const [open, setOpen] = useState(false);

  const invalidate = async () => {
    await utils.products.listAll.invalidate();
    await utils.products.list.invalidate();
  };

  const saveProduct = trpc.products.update.useMutation({
    onSuccess: () => finishSave(),
  });
  const createProduct = trpc.products.create.useMutation({
    onSuccess: () => finishSave(),
  });
  const deleteProduct = trpc.products.delete.useMutation({
    onSuccess: invalidate,
  });

  const finishSave = async () => {
    await invalidate();
    setOpen(false);
    setEditing(null);
  };

  const startCreate = () => {
    const firstCol = collections?.[0];
    if (!firstCol) {
      alert("Сначала создайте хотя бы одну коллекцию");
      return;
    }
    setEditing({
      ...EMPTY_FORM,
      collectionId: firstCol.id,
      sortOrder: (products?.length ?? 0) + 1,
    });
    setOpen(true);
  };

  const startEdit = (p: Product) => {
    setEditing({
      id: p.id,
      collectionId: p.collectionId,
      name: p.name,
      material: p.material ?? "",
      price: p.price,
      image: p.image ?? "",
      isActive: p.isActive,
      sortOrder: p.sortOrder ?? 0,
    });
    setOpen(true);
  };

  const submit = () => {
    if (!editing || !editing.name.trim()) return;
    const payload = {
      collectionId: editing.collectionId,
      name: editing.name.trim(),
      material: editing.material,
      price: editing.price,
      image: editing.image || null,
      sortOrder: editing.sortOrder,
    };
    if (editing.id) {
      saveProduct.mutate({
        id: editing.id,
        ...payload,
        isActive: editing.isActive,
      });
    } else {
      createProduct.mutate(payload);
    }
  };

  return (
    <AdminLayout
      title="Товары"
      description={`${products?.length ?? 0} шт. в каталоге`}
      actions={<Button onClick={startCreate}>+ Добавить товар</Button>}
    >
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Коллекция</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(products ?? []).map((p) => {
              const col = collections?.find((c) => c.id === p.collectionId);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.image ? (
                      <img
                        src={p.image}
                        alt=""
                        className="h-10 w-10 rounded object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-slate-100" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-slate-600">
                    {col?.title ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {p.price.toLocaleString("ru-RU")} ₽
                  </TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <Badge variant="success">Виден</Badge>
                    ) : (
                      <Badge variant="outline">Скрыт</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(p)}
                      >
                        Изменить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          saveProduct.mutate({
                            id: p.id,
                            isActive: !p.isActive,
                          })
                        }
                      >
                        {p.isActive ? "Скрыть" : "Показать"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-700 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(`Удалить «${p.name}»?`))
                            deleteProduct.mutate({ id: p.id });
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {(products ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-slate-500 py-10"
                >
                  Товаров пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Модалка редактирования */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Редактировать товар" : "Новый товар"}
            </DialogTitle>
            <DialogDescription>
              Заполните поля. Звёздочкой (*) отмечены обязательные.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="grid gap-4">
              <div>
                <Label>Коллекция</Label>
                <Select
                  value={String(editing.collectionId)}
                  onValueChange={(v) =>
                    setEditing({ ...editing, collectionId: Number(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите коллекцию" />
                  </SelectTrigger>
                  <SelectContent>
                    {(collections ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Название *</Label>
                <Input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>Материал</Label>
                <Input
                  value={editing.material}
                  onChange={(e) =>
                    setEditing({ ...editing, material: e.target.value })
                  }
                  placeholder="Глина, молочный обжиг"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Цена, ₽ *</Label>
                  <Input
                    type="number"
                    value={editing.price}
                    onChange={(e) =>
                      setEditing({ ...editing, price: Number(e.target.value) })
                    }
                    min={1}
                  />
                </div>
                <div>
                  <Label>Порядок</Label>
                  <Input
                    type="number"
                    value={editing.sortOrder}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        sortOrder: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <Label>Ссылка на фото</Label>
                <Input
                  value={editing.image}
                  onChange={(e) =>
                    setEditing({ ...editing, image: e.target.value })
                  }
                  placeholder="/img/p1.png или /uploads/…"
                />
                <ImageUpload
                  onUpload={(image) =>
                    setEditing((current) =>
                      current ? { ...current, image } : current,
                    )
                  }
                />
                {editing.image && (
                  <img
                    src={editing.image}
                    alt=""
                    className="mt-2 h-20 w-20 rounded object-cover border border-slate-200"
                  />
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) =>
                    setEditing({ ...editing, isActive: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                Виден на сайте
              </label>
            </div>
          )}

          {(saveProduct.error || createProduct.error) && (
            <p role="alert" className="text-sm text-red-700">
              {(saveProduct.error || createProduct.error)?.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submit}
              disabled={
                !editing?.name.trim() ||
                saveProduct.isPending ||
                createProduct.isPending
              }
            >
              {editing?.id ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

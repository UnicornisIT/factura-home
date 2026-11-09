import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { BlockForm } from "@/components/builder/BlockForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  BLOCK_LABELS,
  BLOCK_LIBRARY,
  MAX_BLOCKS,
  SINGLETON_BLOCK_TYPES,
  blockDefaults,
  type Block,
  type BlockData,
  type BlockType,
} from "@contracts/blocks";

function blockSummary(block: Block): string {
  const data = block.data as { title?: string; text?: string };
  if (data.title) return data.title;
  if (data.text) return data.text.slice(0, 60);
  return BLOCK_LABELS[block.type];
}

function SortableBlockCard({
  block,
  onEdit,
  onToggleVisible,
  onDelete,
}: {
  block: Block;
  onEdit: () => void;
  onToggleVisible: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });
  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : block.isVisible ? 1 : 0.55,
      }}
      className="flex items-center gap-2 p-3"
    >
      <button
        type="button"
        className="cursor-grab touch-none p-1.5 text-slate-400 hover:text-slate-700"
        aria-label={`Переместить блок «${BLOCK_LABELS[block.type]}»`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {blockSummary(block)}
          </span>
          <Badge variant="brand">{BLOCK_LABELS[block.type]}</Badge>
          {!block.isVisible && <Badge variant="warning">скрыт</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onToggleVisible}
          aria-label={block.isVisible ? "Скрыть блок" : "Показать блок"}
          title={block.isVisible ? "Скрыть с сайта" : "Показать на сайте"}
        >
          {block.isVisible ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onEdit}
          aria-label="Редактировать блок"
          title="Редактировать"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-red-600 hover:text-red-700"
          onClick={onDelete}
          aria-label="Удалить блок"
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

export default function Builder() {
  const utils = trpc.useUtils();
  const { data: blocks } = trpc.blocks.listAll.useQuery();
  const ordered = useMemo(
    () => [...(blocks ?? [])].sort((a, b) => a.position - b.position),
    [blocks],
  );

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState<Block | null>(null);
  const [draft, setDraft] = useState<BlockData | null>(null);
  const [draftBg, setDraftBg] = useState<string | null>(null);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const invalidate = async () => {
    await Promise.all([
      utils.blocks.listAll.invalidate(),
      utils.blocks.list.invalidate(),
    ]);
  };

  const createBlock = trpc.blocks.create.useMutation({
    onSuccess: async () => {
      setLibraryOpen(false);
      setError("");
      await invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const updateBlock = trpc.blocks.update.useMutation({
    onSuccess: async () => {
      setEditing(null);
      setDraft(null);
      setDraftBg(null);
      setError("");
      await invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const deleteBlock = trpc.blocks.delete.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  });
  const reorderBlocks = trpc.blocks.reorder.useMutation({
    onSuccess: invalidate,
    onError: (e) => {
      setError(e.message);
      void invalidate();
    },
  });

  const startEdit = (block: Block) => {
    setEditing(block);
    setDraft(structuredClone(block.data));
    setDraftBg(block.background);
    setError("");
  };

  const startCreate = (type: BlockType) => {
    setError("");
    createBlock.mutate({ type, data: blockDefaults(type) });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((b) => b.id === active.id);
    const newIndex = ordered.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ordered, oldIndex, newIndex).map((b, index) => ({
      ...b,
      position: index + 1,
    }));
    // Оптимистично обновляем порядок, сервер проверяет состав блоков.
    utils.blocks.listAll.setData(undefined, next);
    reorderBlocks.mutate({ ids: next.map((b) => b.id) });
  };

  const usedSingletons = new Set(
    ordered
      .filter((b) => SINGLETON_BLOCK_TYPES.includes(b.type))
      .map((b) => b.type),
  );

  return (
    <AdminLayout
      title="Конструктор страницы"
      description="Блоки главной страницы: добавляйте, переставляйте перетаскиванием, скрывайте и редактируйте"
      actions={
        <Button
          onClick={() => {
            setError("");
            setLibraryOpen(true);
          }}
          disabled={ordered.length >= MAX_BLOCKS}
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить блок
        </Button>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={ordered.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-2">
            {ordered.map((block) => (
              <SortableBlockCard
                key={block.id}
                block={block}
                onEdit={() => startEdit(block)}
                onToggleVisible={() =>
                  updateBlock.mutate({
                    id: block.id,
                    isVisible: !block.isVisible,
                  })
                }
                onDelete={() => {
                  if (
                    window.confirm(
                      `Удалить блок «${BLOCK_LABELS[block.type]}»? Действие необратимо.`,
                    )
                  )
                    deleteBlock.mutate({ id: block.id });
                }}
              />
            ))}
            {ordered.length === 0 && (
              <Card className="p-8 text-center text-slate-500">
                Блоков пока нет — добавьте первый из библиотеки.
              </Card>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <p className="mt-6 text-xs text-slate-500">
        Шапка, футер и контакты настраиваются в разделе «Тексты и контакты».
        Порядок блоков сохраняется автоматически после перетаскивания.
      </p>

      {/* Библиотека блоков */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить блок</DialogTitle>
            <DialogDescription>
              Выберите блок из библиотеки — его содержимое можно изменить сразу
              после добавления.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BLOCK_LIBRARY.map((entry) => {
              const disabled = SINGLETON_BLOCK_TYPES.includes(entry.type)
                ? usedSingletons.has(entry.type)
                : false;
              return (
                <button
                  key={entry.type}
                  type="button"
                  disabled={disabled || createBlock.isPending}
                  onClick={() => startCreate(entry.type)}
                  className="rounded-md border border-slate-200 p-3 text-left transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="text-sm font-medium">{entry.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {entry.description}
                  </div>
                  {disabled && (
                    <div className="mt-1 text-[11px] text-amber-600">
                      Уже добавлен — блок может быть только один
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Редактирование блока */}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setDraft(null);
            setDraftBg(null);
            setError("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? BLOCK_LABELS[editing.type] : ""}
            </DialogTitle>
            <DialogDescription>
              Изменения появятся на сайте сразу после сохранения.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Label>Цвет фона блока</Label>
            <input
              type="color"
              value={draftBg ?? "#f5ede0"}
              disabled={!draftBg}
              onChange={(e) => setDraftBg(e.target.value)}
              className="h-9 w-16 rounded-md border border-input bg-transparent p-1"
              aria-label="Цвет фона блока"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraftBg(draftBg ? null : "#f5ede0")}
            >
              {draftBg ? "Сбросить" : "Задать цвет"}
            </Button>
          </div>
          {editing && draft && (
            <BlockForm block={editing} data={draft} onChange={setDraft} />
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setDraft(null);
                setDraftBg(null);
              }}
            >
              Отмена
            </Button>
            <Button
              onClick={() =>
                editing &&
                draft &&
                updateBlock.mutate({
                  id: editing.id,
                  data: draft,
                  background: draftBg,
                })
              }
              disabled={updateBlock.isPending || !draft}
            >
              {updateBlock.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

import { useEffect, useState } from "react";
import { useBeforeUnload, useBlocker, useSearchParams } from "react-router";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { BlockForm } from "@/components/builder/BlockForm";
import { StorefrontPreview } from "@/components/builder/StorefrontPreview";
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
  createTemporaryBlockId,
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
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 cursor-grab touch-none text-slate-500"
        aria-label={`Переместить блок «${BLOCK_LABELS[block.type]}»`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="max-w-full truncate text-sm font-medium">
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
          title={
            block.isVisible ? "Скрыть в черновике" : "Показать в черновике"
          }
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
  const query = trpc.blocks.draft.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(searchParams.get("preview") === "1");
  const [working, setWorking] = useState<{
    version: number;
    blocks: Block[];
  }>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState<Block | null>(null);
  const [draft, setDraft] = useState<BlockData | null>(null);
  const [draftBg, setDraftBg] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const save = trpc.blocks.draft.save.useMutation();
  const publish = trpc.blocks.draft.publish.useMutation();
  const restore = trpc.blocks.draft.restore.useMutation();
  const pending = save.isPending || publish.isPending || restore.isPending;
  const formChanged =
    !!editing &&
    (JSON.stringify(editing.data) !== JSON.stringify(draft) ||
      editing.background !== draftBg);
  const unsaved = !!working || formChanged;
  const ordered = working?.blocks ?? query.data?.blocks ?? [];
  const previewBlocks =
    formChanged && editing && draft
      ? ordered.map((block) =>
          block.id === editing.id
            ? ({ ...block, data: draft, background: draftBg } as Block)
            : block,
        )
      : ordered;
  const leaveMessage = "Есть несохранённые изменения. Покинуть редактор?";
  const blocker = useBlocker(
    ({ nextLocation, historyAction }) =>
      unsaved &&
      !(
        historyAction === "REPLACE" &&
        nextLocation.state?.loggedOut === true &&
        nextLocation.pathname.endsWith("/login")
      ),
  );

  useBeforeUnload((event) => {
    if (unsaved) event.preventDefault();
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(leaveMessage)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const changeBlocks = (blocks: Block[]) => {
    if (!query.data || pending || query.isFetching) return;
    setWorking({
      version: working?.version ?? query.data.version,
      blocks: blocks.map((block, index) => ({ ...block, position: index + 1 })),
    });
    if (!conflict) setError("");
  };

  const write = (action: "save" | "publish" | "restore") => {
    if (!query.data || pending || query.isFetching || conflict) return;
    if (action === "save" && !working) return;
    const version = working?.version ?? query.data.version;
    setError("");
    const callbacks = {
      onSuccess: (next: typeof query.data) => {
        utils.blocks.draft.get.setData(undefined, next);
        setWorking(undefined);
      },
      onError: (failure: typeof save.error) => {
        setError(failure?.message ?? "Сервер не подтвердил изменения.");
        setConflict(failure?.data?.code === "CONFLICT");
      },
    };
    if (action === "save" && working) save.mutate(working, callbacks);
    if (action === "publish") publish.mutate({ version }, callbacks);
    if (action === "restore") restore.mutate({ version }, callbacks);
  };

  const reload = async () => {
    if (
      unsaved &&
      !window.confirm(
        "Загрузить актуальный черновик и отменить локальные изменения?",
      )
    )
      return;
    const result = await query.refetch();
    if (result.isSuccess) {
      setWorking(undefined);
      setConflict(false);
      setError("");
    } else setError(result.error?.message ?? "Не удалось загрузить черновик.");
  };

  const closeEdit = () => {
    setEditing(null);
    setDraft(null);
    setDraftBg(null);
  };

  const startEdit = (block: Block) => {
    setEditing(block);
    setDraft(structuredClone(block.data));
    setDraftBg(block.background);
    setError("");
  };

  const startCreate = (type: BlockType) => {
    changeBlocks([
      ...ordered,
      {
        id: createTemporaryBlockId(ordered),
        type,
        data: blockDefaults(type),
        isVisible: true,
        background: null,
        position: ordered.length + 1,
      } as Block,
    ]);
    setLibraryOpen(false);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((b) => b.id === active.id);
    const newIndex = ordered.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    changeBlocks(arrayMove(ordered, oldIndex, newIndex));
  };

  const usedSingletons = new Set(
    ordered
      .filter((b) => SINGLETON_BLOCK_TYPES.includes(b.type))
      .map((b) => b.type),
  );

  return (
    <AdminLayout
      title="Редактор главной страницы"
      onBeforeLogout={() => !unsaved || window.confirm(leaveMessage)}
    >
      {(error || query.error) && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error || query.error?.message}
          {(conflict || query.isError) && (
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void reload()}
            >
              Загрузить актуальный черновик
            </Button>
          )}
        </div>
      )}
      {query.isPending && <p role="status">Загрузка черновика…</p>}
      {query.data && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3">
            <div
              role="status"
              aria-live="polite"
              className="flex flex-wrap items-center gap-2"
            >
              <Badge
                variant={unsaved || query.data.hasChanges ? "warning" : "brand"}
              >
                {unsaved || query.data.hasChanges
                  ? "Есть неопубликованные изменения"
                  : "Опубликовано"}
              </Badge>
              <span className="text-sm text-slate-600">
                {save.isPending
                  ? "Сохраняется…"
                  : publish.isPending
                    ? "Публикуется…"
                    : restore.isPending
                      ? "Восстанавливается…"
                      : save.isError && error
                        ? "Ошибка сохранения"
                        : unsaved
                          ? "Есть несохранённые изменения"
                          : query.data.hasChanges ||
                              save.data?.version === query.data.version
                            ? "Черновик сохранён"
                            : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpanded(true)}
              >
                Предпросмотр
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  pending ||
                  query.isFetching ||
                  conflict ||
                  (!unsaved && !query.data.hasChanges)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Отменить изменения черновика и восстановить опубликованную версию?",
                    )
                  )
                    write("restore");
                }}
              >
                Восстановить опубликованное
              </Button>
              {unsaved && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    pending || query.isFetching || conflict || formChanged
                  }
                  onClick={() => write("save")}
                >
                  Сохранить черновик
                </Button>
              )}
              <Button
                size="sm"
                disabled={
                  unsaved ||
                  pending ||
                  query.isFetching ||
                  conflict ||
                  !query.data.hasChanges
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Опубликовать черновик? Посетители увидят обновлённую главную страницу.",
                    )
                  )
                    write("publish");
                }}
              >
                Опубликовать
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)]">
            <fieldset
              disabled={pending || query.isFetching}
              className="min-w-0 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Структура страницы</h2>
                <Button
                  size="sm"
                  onClick={() => setLibraryOpen(true)}
                  disabled={ordered.length >= MAX_BLOCKS}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Добавить блок
                </Button>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={ordered.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-2">
                    {ordered.map((block) => (
                      <SortableBlockCard
                        key={block.id}
                        block={block}
                        onEdit={() => startEdit(block)}
                        onToggleVisible={() =>
                          changeBlocks(
                            ordered.map((item) =>
                              item.id === block.id
                                ? { ...item, isVisible: !item.isVisible }
                                : item,
                            ),
                          )
                        }
                        onDelete={() => {
                          if (
                            window.confirm(
                              `Удалить блок «${BLOCK_LABELS[block.type]}» из черновика?`,
                            )
                          )
                            changeBlocks(
                              ordered.filter((item) => item.id !== block.id),
                            );
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
            </fieldset>
            <StorefrontPreview
              blocks={previewBlocks}
              version={query.data.version}
              expanded={expanded}
              onCollapse={() => setExpanded(false)}
            />
          </div>
        </>
      )}
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
                <Button
                  key={entry.type}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => startCreate(entry.type)}
                  className="block h-auto whitespace-normal p-3 text-left"
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
                </Button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Редактирование блока */}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (
            !open &&
            (!formChanged || window.confirm("Отменить изменения блока?"))
          )
            closeEdit();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? BLOCK_LABELS[editing.type] : ""}
            </DialogTitle>
            <DialogDescription>
              Изменения появятся на витрине после публикации страницы.
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
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (!editing || !draft) return;
                changeBlocks(previewBlocks);
                closeEdit();
              }}
              disabled={!formChanged}
            >
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

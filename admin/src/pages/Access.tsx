import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type Role = "admin" | "super_admin";

export default function Access() {
  const utils = trpc.useUtils();
  const { data: allowlist, isLoading } = trpc.allowlist.list.useQuery();
  const { data: auditLog } = trpc.allowlist.audit.useQuery();
  const { user: currentUser } = useAuth();

  const [newTelegramId, setNewTelegramId] = useState("");
  const [newRole, setNewRole] = useState<Role>("admin");

  const addMutation = trpc.allowlist.add.useMutation({
    onSuccess: () => {
      void utils.allowlist.list.invalidate();
      void utils.allowlist.audit.invalidate();
    },
    onError: (e) => alert(e.message),
  });
  const deactivateMutation = trpc.allowlist.deactivate.useMutation({
    onSuccess: () => {
      void utils.allowlist.list.invalidate();
      void utils.allowlist.audit.invalidate();
    },
    onError: (e) => alert(e.message),
  });
  const updateRoleMutation = trpc.allowlist.updateRole.useMutation({
    onSuccess: () => {
      void utils.allowlist.list.invalidate();
      void utils.allowlist.audit.invalidate();
    },
    onError: (e) => alert(e.message),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(newTelegramId);
    if (!Number.isFinite(id) || id <= 0) {
      alert("Введите числовой Telegram ID");
      return;
    }
    addMutation.mutate(
      { telegramId: id, role: newRole },
      {
        onSuccess: () => {
          setNewTelegramId("");
          setNewRole("admin");
        },
      },
    );
  };

  return (
    <AdminLayout
      title="Доступ"
      description="Список Telegram ID, которым разрешён вход в админ-панель"
      requireRole="super_admin"
    >
      {/* Добавить нового */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Добавить Telegram ID</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label>Telegram ID</Label>
              <Input
                type="number"
                value={newTelegramId}
                onChange={(e) => setNewTelegramId(e.target.value)}
                placeholder="123456789"
              />
            </div>
            <div className="w-44">
              <Label>Роль</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as Role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="super_admin">super_admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={addMutation.isPending || !newTelegramId.trim()}
            >
              {addMutation.isPending ? "Добавление…" : "+ Добавить"}
            </Button>
          </form>
          <p className="text-xs text-slate-500 mt-2">
            Узнать свой Telegram ID можно у{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener"
              className="text-[#5C2A2A] hover:underline"
            >
              @userinfobot
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Таблица allowlist */}
      <Card>
        <CardHeader>
          <CardTitle>
            Разрешённые пользователи ({allowlist?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telegram ID</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Добавлен</TableHead>
                <TableHead>Кем</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-slate-500 py-6"
                  >
                    Загрузка…
                  </TableCell>
                </TableRow>
              )}
              {(allowlist ?? []).map((entry) => {
                const isMe = currentUser?.telegramId === entry.telegramId;
                const isBootstrap = entry.isOwner;
                return (
                  <TableRow
                    key={entry.id}
                    className={!entry.isActive ? "opacity-50" : ""}
                  >
                    <TableCell className="font-mono text-sm">
                      {entry.telegramId}
                      {isBootstrap && (
                        <span className="ml-2 text-xs text-slate-400">
                          (владелец)
                        </span>
                      )}
                      {isMe && (
                        <span className="ml-2 text-xs text-[#5C2A2A]">
                          — это вы
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <RoleSelect
                        value={entry.role as Role}
                        disabled={
                          !entry.isActive ||
                          isBootstrap ||
                          updateRoleMutation.isPending
                        }
                        onChange={(role) =>
                          confirm(
                            `Изменить роль Telegram ID ${entry.telegramId}?`,
                          ) &&
                          updateRoleMutation.mutate({
                            telegramId: entry.telegramId,
                            role,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {entry.isActive ? (
                        <Badge variant="success">активен</Badge>
                      ) : (
                        <Badge variant="outline">деактивирован</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {new Date(entry.addedAt).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500 font-mono">
                      {entry.addedByTelegramId ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.isActive && !isMe && !isBootstrap && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (
                              confirm(
                                `Деактивировать Telegram ID ${entry.telegramId}?`,
                              )
                            ) {
                              deactivateMutation.mutate({
                                telegramId: entry.telegramId,
                              });
                            }
                          }}
                        >
                          Деактивировать
                        </Button>
                      )}
                      {!entry.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            addMutation.mutate({
                              telegramId: entry.telegramId,
                              role: entry.role as Role,
                            })
                          }
                        >
                          Реактивировать
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(allowlist ?? []).length === 0 && !isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-slate-500 py-8"
                  >
                    Список пуст.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Журнал действий</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Исполнитель</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Цель</TableHead>
                <TableHead>Роли</TableHead>
                <TableHead>Итог</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(auditLog ?? []).map((row) => (
                <TableRow key={String(row.id)}>
                  <TableCell>
                    {new Date(Number(row.createdAt)).toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell>{String(row.actorTelegramId)}</TableCell>
                  <TableCell>{String(row.action)}</TableCell>
                  <TableCell>{String(row.targetTelegramId ?? "—")}</TableCell>
                  <TableCell>
                    {String(row.roleBefore ?? "—")} →{" "}
                    {String(row.roleAfter ?? "—")}
                  </TableCell>
                  <TableCell>{String(row.outcome)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: Role;
  disabled?: boolean;
  onChange: (v: Role) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as Role)}
      disabled={disabled}
    >
      <SelectTrigger className="w-36 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">admin</SelectItem>
        <SelectItem value="super_admin">super_admin</SelectItem>
      </SelectContent>
    </Select>
  );
}

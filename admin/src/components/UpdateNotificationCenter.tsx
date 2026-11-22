import { useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router";
import {
  updateEventDescription,
  updateEventTitles,
} from "@contracts/update-notifications";
import { formatDateTime } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { TelegramNotificationSettings } from "./OrderTelegramSettings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function UpdateNotificationCenter({
  superAdmin,
}: {
  superAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [settings, showSettings] = useState(false);
  const [page, setPage] = useState(0);
  const utils = trpc.useUtils();
  const inbox = trpc.updateNotifications.inbox.useQuery(
    { page },
    { refetchInterval: 30_000 },
  );
  const invalidate = () => void utils.updateNotifications.inbox.invalidate();
  const markRead = trpc.updateNotifications.markRead.useMutation({
    onSuccess: invalidate,
  });
  const markAll = trpc.updateNotifications.markAllRead.useMutation({
    onSuccess: invalidate,
  });
  const unread = inbox.data?.unread ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPage(0);
          showSettings(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="relative size-11 shrink-0"
          aria-label={
            unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"
          }
        >
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 rounded-full bg-brand px-1 text-[10px] leading-4 text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Уведомления</DialogTitle>
          <DialogDescription>
            Релизы и результаты обновлений магазина.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!unread || markAll.isPending || markRead.isPending}
            onClick={() => markAll.mutate()}
          >
            Прочитать все
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={settings}
            onClick={() => showSettings((value) => !value)}
          >
            Настроить Telegram
          </Button>
          {superAdmin && (
            <DialogClose asChild>
              <Button size="sm" variant="outline" asChild>
                <Link to="/server-update">Обновление сервера</Link>
              </Button>
            </DialogClose>
          )}
        </div>
        {settings && <TelegramNotificationSettings topic="updates" />}
        {(inbox.isError || markRead.isError || markAll.isError) && (
          <p role="alert" className="text-sm text-red-700">
            {inbox.isError
              ? "Не удалось загрузить уведомления."
              : "Не удалось отметить уведомление прочитанным."}
          </p>
        )}
        {inbox.isPending && (
          <p role="status" className="text-sm text-slate-600">
            Загрузка…
          </p>
        )}
        {inbox.data?.items.length === 0 && (
          <p className="text-sm text-slate-600">Уведомлений пока нет.</p>
        )}
        {!!inbox.data?.items.length && (
          <ul className="grid min-w-0 gap-2">
            {inbox.data.items.map((event) => (
              <li
                key={event.id}
                className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {updateEventTitles[event.kind]}
                  </h3>
                  <Badge variant={event.isRead ? "outline" : "warning"}>
                    {event.isRead ? "Прочитано" : "Новое"}
                  </Badge>
                </div>
                <p className="text-sm text-slate-700">
                  {updateEventDescription(event)}
                </p>
                {event.releaseSummary && (
                  <p className="whitespace-pre-line text-sm text-slate-700">
                    {event.releaseSummary}
                  </p>
                )}
                <p className="text-xs text-slate-600">
                  <time dateTime={new Date(event.createdAt).toISOString()}>
                    {formatDateTime(event.createdAt)}
                  </time>
                </p>
                <div className="flex flex-wrap gap-2">
                  {event.releaseUrl && (
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={event.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Посмотреть релиз
                      </a>
                    </Button>
                  )}
                  {!event.isRead && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={markRead.isPending || markAll.isPending}
                      onClick={() => markRead.mutate({ eventId: event.id })}
                    >
                      Отметить прочитанным
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {(page > 0 || inbox.data?.hasNext) && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!inbox.data?.hasNext}
              onClick={() => setPage(page + 1)}
            >
              Далее
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

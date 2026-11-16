import { useId, useState } from "react";
import { ChevronUp, Github, Mail } from "lucide-react";
import { MessengerIcon } from "@server/src/components/Icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DeveloperContacts() {
  const [open, setOpen] = useState(false);
  const contactsId = useId();

  return (
    <footer
      aria-label="Контакты разработчика"
      className="mx-auto flex min-h-40 w-full max-w-md flex-col items-center justify-end px-2 pb-6 text-center before:mb-4 before:w-full before:border-t before:border-slate-700 max-[340px]:min-h-48"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={contactsId}
        onClick={() => setOpen((value) => !value)}
        className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700 motion-reduce:transition-none"
      >
        Контакты разработчика
        <ChevronUp
          aria-hidden="true"
          className={cn(
            "motion-safe:transition-transform motion-safe:duration-300",
            open && "rotate-180",
          )}
        />
      </Button>
      <div
        id={contactsId}
        inert={!open}
        aria-hidden={!open}
        className={cn(
          "grid w-full motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 px-1 pb-1 pt-3">
            <p className="text-xs text-slate-400">
              UnicornisIT · Связь и предложения
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://github.com/UnicornisIT"
                  target="_blank"
                  rel="noopener"
                >
                  <Github aria-hidden="true" />
                  GitHub
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href="https://t.me/unicornis_pulse"
                  target="_blank"
                  rel="noopener"
                >
                  <span className="text-sky-600">
                    <MessengerIcon kind="telegram" />
                  </span>
                  Telegram
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="mailto:dev-eva@outlook.com">
                  <Mail aria-hidden="true" />
                  Почта
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

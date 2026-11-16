import { Github, Mail } from "lucide-react";
import { MessengerIcon } from "@server/src/components/Icon";
import { Button } from "@/components/ui/button";

export function DeveloperContacts() {
  return (
    <footer
      aria-label="Контакты разработчика"
      className="mx-auto w-full max-w-md space-y-3 border-t border-slate-700 px-2 pb-6 pt-4 text-center"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-white">
          Контакты разработчика
        </h2>
        <p className="text-xs text-slate-400">
          UnicornisIT · Связь и предложения
        </p>
      </div>
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
          <a href="https://t.me/unicornis_pulse" target="_blank" rel="noopener">
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
    </footer>
  );
}

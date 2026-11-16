import type { Root } from "mdast";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const technicalHeading =
  /^(технические (изменения|детали|заметки|подробности)|для разработчиков|инфраструктура|деплой|technical (changes|details|notes)|engineering|infrastructure|deployment)$/i;
const technicalNote =
  /\b(?:shellcheck|systemd(?:-run|-analyze)?|sudoers|healthcheck|github_token|server_update_\w+|\d{3}_[a-z][\w_]+|deployment\/[^\s]+|app\/\.env)\b|при обновлении .*миграция/i;

type NoteNode = {
  type: string;
  value?: string;
  children?: readonly NoteNode[];
};

function noteText(node: NoteNode): string {
  return node.value ?? node.children?.map(noteText).join(" ") ?? "";
}

function hideTechnicalNotes() {
  return (tree: Root) => {
    let hiddenDepth: number | null = null;
    const visible = tree.children.filter((node) => {
      if (node.type === "heading") {
        if (hiddenDepth !== null && node.depth > hiddenDepth) return false;
        hiddenDepth = technicalHeading.test(noteText(node).trim())
          ? node.depth
          : null;
      }
      if (hiddenDepth !== null) return false;

      if (node.type === "list") {
        node.children = node.children.filter(
          (item) => !technicalNote.test(noteText(item)),
        );
        return node.children.length > 0;
      }

      return node.type !== "paragraph" || !technicalNote.test(noteText(node));
    });
    tree.children = visible.filter((node, index) => {
      if (node.type !== "heading") return true;
      const next = visible[index + 1];
      return next && (next.type !== "heading" || next.depth > node.depth);
    });
  };
}

export function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div
      role="region"
      aria-label="Что нового"
      tabIndex={0}
      className="release-notes max-h-72 overflow-auto rounded-sm text-sm leading-relaxed text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <Markdown remarkPlugins={[remarkGfm, hideTechnicalNotes]} skipHtml>
        {notes}
      </Markdown>
    </div>
  );
}

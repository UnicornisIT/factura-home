import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

type Node = {
  type: string;
  children?: readonly Node[];
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
};

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

export function escapeTelegram(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeLink(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
  return null;
}

export function publicReleaseUrl(value: string | null) {
  const safe = safeLink(value ?? undefined);
  if (!safe) return null;
  const url = new URL(safe);
  return url.origin === "https://github.com" &&
    /^\/[\w.-]+\/[\w.-]+\/releases\/tag\/.+/.test(url.pathname)
    ? url.origin + url.pathname
    : null;
}

export function releaseExcerpt(body: string, limit: number, html = false) {
  let remaining = limit;
  const escaped = (text: string) => (html ? escapeTelegram(text) : text);
  function write(text: string) {
    if (remaining <= 0) return "";
    if (text.length <= remaining) {
      remaining -= text.length;
      return escaped(text);
    }
    const shortened = text
      .slice(0, remaining - 1)
      .replace(/[\uD800-\uDBFF]$/, "");
    remaining = 0;
    return escaped(shortened + "…");
  }
  const wrap = (tag: string, text: string) =>
    html && text ? `<${tag}>${text}</${tag}>` : text;
  try {
    const root: Node = parser.parse(body);
    const references = new Map<string, string>();
    for (const child of root.children ?? []) {
      if (
        child.type === "definition" &&
        child.identifier &&
        child.url &&
        !references.has(child.identifier)
      )
        references.set(child.identifier, child.url);
    }
    function render(node: Node): string {
      if (remaining <= 0) return "";
      const renderChildren = (separator = "") =>
        (node.children ?? []).reduce((result, child) => {
          if (remaining <= 0 || ["definition", "html"].includes(child.type))
            return result;
          return result + (result ? write(separator) : "") + render(child);
        }, "");
      switch (node.type) {
        case "root":
          return renderChildren("\n\n");
        case "heading":
        case "strong":
          return wrap("b", renderChildren());
        case "emphasis":
          return wrap("i", renderChildren());
        case "delete":
          return wrap("s", renderChildren());
        case "code":
          return wrap("pre", write(node.value ?? ""));
        case "inlineCode":
          return wrap("code", write(node.value ?? ""));
        case "text":
          return write(node.value ?? "");
        case "break":
          return write("\n");
        case "image":
        case "imageReference":
          return write(node.alt ?? "");
        case "link":
        case "linkReference": {
          const href = safeLink(
            node.url ?? references.get(node.identifier ?? "")
          );
          const label = renderChildren();
          return html && href && label
            ? `<a href="${escapeTelegram(href)}">${label}</a>`
            : label;
        }
        case "blockquote":
          return write("› ") + renderChildren("\n");
        case "list":
          return (node.children ?? []).reduce((result, item, index) => {
            if (remaining <= 0) return result;
            const marker = node.ordered ? `${(node.start ?? 1) + index}.` : "•";
            const checked =
              item.checked == null ? "" : item.checked ? "☑ " : "☐ ";
            return (
              result +
              write(`${index ? "\n" : ""}${marker} ${checked}`) +
              render(item)
            );
          }, "");
        case "table":
          return renderChildren("\n");
        case "tableRow":
          return renderChildren(" · ");
        case "listItem":
          return renderChildren("\n");
        case "html":
        case "definition":
        case "thematicBreak":
          return "";
        default:
          return renderChildren();
      }
    }
    return render(root).trim();
  } catch {
    // The release link still gives access to the source when parsing fails.
    return "Описание релиза недоступно.";
  }
}

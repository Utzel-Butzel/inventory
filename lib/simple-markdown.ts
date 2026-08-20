const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const HEADING_CLASSES = {
  1: "mb-4 mt-7 text-2xl font-semibold tracking-tight text-foreground",
  2: "mb-3 mt-6 text-xl font-semibold tracking-tight text-foreground",
  3: "mb-3 mt-5 text-lg font-semibold tracking-tight text-foreground",
  4: "mb-2 mt-5 text-base font-semibold text-foreground",
  5: "mb-2 mt-4 text-sm font-semibold text-foreground",
  6: "mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted",
} as const;

const PARAGRAPH_CLASS = "mb-3 text-sm leading-7 text-muted-strong";
const INLINE_CODE_CLASS =
  "rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.95em] text-foreground";
const LINK_CLASS =
  "text-brand underline underline-offset-2 hover:text-brand-strong";
const IMAGE_CLASS = "w-full rounded-xl border border-border";
const STRONG_CLASS = "font-semibold text-foreground";
const EMPHASIS_CLASS = "italic";
const UNDERLINE_CLASS = "underline underline-offset-2";
const BLOCKQUOTE_CLASS =
  "my-5 border-l-4 border-border pl-4 italic text-muted-strong";
const UNORDERED_LIST_CLASS =
  "mb-3 list-disc space-y-1.5 pl-6 text-sm leading-7 text-muted-strong";
const ORDERED_LIST_CLASS =
  "mb-3 list-decimal space-y-1.5 pl-6 text-sm leading-7 text-muted-strong";
const LIST_ITEM_CLASS = "pl-1";
const HR_CLASS = "my-6 border-border";

const withClass = (tag: string, className: string, content: string) =>
  `<${tag} class="${className}">${content}</${tag}>`;

const sanitizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const renderInline = (value: string) => {
  const escaped = escapeHtml(value);

  return escaped
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => {
      const sanitized = sanitizeUrl(src);
      if (!sanitized) return alt;
      return `<img class="${IMAGE_CLASS}" src="${escapeHtml(sanitized)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    })
    .replace(
      /`([^`]+)`/g,
      (_, code: string) => `<code class="${INLINE_CODE_CLASS}">${code}</code>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, `<strong class="${STRONG_CLASS}">$1</strong>`)
    .replace(/\*([^*]+)\*/g, `<em class="${EMPHASIS_CLASS}">$1</em>`)
    .replace(
      /&lt;u&gt;(.+?)&lt;\/u&gt;/g,
      `<u class="${UNDERLINE_CLASS}">$1</u>`,
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
      const sanitized = sanitizeUrl(href);
      if (!sanitized) return label;
      const external =
        sanitized.startsWith("http://") || sanitized.startsWith("https://");
      return `<a class="${LINK_CLASS}" href="${escapeHtml(sanitized)}"${
        external ? ' target="_blank" rel="noreferrer"' : ""
      }>${label}</a>`;
    });
};

const isHeadingLine = (value: string) => /^#{1,6}\s+/.test(value.trim());
const isUnorderedListLine = (value: string) => /^\s*[-*+]\s+/.test(value);
const isOrderedListLine = (value: string) => /^\s*\d+\.\s+/.test(value);
const isQuoteLine = (value: string) => /^\s*>\s?/.test(value);
const isHorizontalRuleLine = (value: string) => /^---+$/.test(value.trim());
const isBlockLine = (value: string) =>
  isHeadingLine(value) ||
  isUnorderedListLine(value) ||
  isOrderedListLine(value) ||
  isQuoteLine(value) ||
  isHorizontalRuleLine(value);

const renderList = (lines: string[], ordered: boolean) => {
  const tag = ordered ? "ol" : "ul";
  const className = ordered ? ORDERED_LIST_CLASS : UNORDERED_LIST_CLASS;
  const items = lines
    .map((line) =>
      ordered ? line.replace(/^\d+\.\s+/, "") : line.replace(/^[-*+]\s+/, ""),
    )
    .map((line) => `<li class="${LIST_ITEM_CLASS}">${renderInline(line)}</li>`)
    .join("");
  return `<${tag} class="${className}">${items}</${tag}>`;
};

export const renderSimpleMarkdown = (value: string) => {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index]!.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isHeadingLine(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      blocks.push(
        withClass(
          `h${level}`,
          HEADING_CLASSES[level as keyof typeof HEADING_CLASSES],
          renderInline(trimmed.replace(/^#{1,6}\s+/, "")),
        ),
      );
      index += 1;
      continue;
    }

    if (isUnorderedListLine(trimmed)) {
      const listLines: string[] = [];
      while (index < lines.length && isUnorderedListLine(lines[index]!)) {
        listLines.push(lines[index]!.trim());
        index += 1;
      }
      blocks.push(renderList(listLines, false));
      continue;
    }

    if (isOrderedListLine(trimmed)) {
      const listLines: string[] = [];
      while (index < lines.length && isOrderedListLine(lines[index]!)) {
        listLines.push(lines[index]!.trim());
        index += 1;
      }
      blocks.push(renderList(listLines, true));
      continue;
    }

    if (isQuoteLine(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && isQuoteLine(lines[index]!)) {
        quoteLines.push(lines[index]!.replace(/^\s*>\s?/, "").trim());
        index += 1;
      }
      blocks.push(
        `<blockquote class="${BLOCKQUOTE_CLASS}"><p class="m-0">${renderInline(quoteLines.join(" "))}</p></blockquote>`,
      );
      continue;
    }

    if (isHorizontalRuleLine(trimmed)) {
      blocks.push(`<hr class="${HR_CLASS}" />`);
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !isBlockLine(lines[index]!)
    ) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push(
      withClass(
        "p",
        PARAGRAPH_CLASS,
        paragraphLines.map(renderInline).join("<br />"),
      ),
    );
  }

  return blocks.join("\n");
};

export const markdownToPlainText = (value: string) =>
  value
    .replace(/<\/?u>/gi, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

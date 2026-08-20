import { renderSimpleMarkdown } from "@/lib/simple-markdown";

export function MarkdownContent({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`markdown-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(value) }}
    />
  );
}

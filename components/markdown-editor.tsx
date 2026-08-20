"use client";

import { useEffect, useRef, useState } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";

type MarkdownEditorImage = {
  url: string;
  label: string;
  thumbnailUrl?: string;
};

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  availableImages?: MarkdownEditorImage[];
  imageButtonLabel: string;
  embedButtonLabel: string;
  closeImagePickerLabel: string;
  availableImagesLabel: string;
  emptyImageMessage: string;
};

const getImageAltText = (value: string) =>
  value
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Image";

export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  readOnly = false,
  availableImages = [],
  imageButtonLabel,
  embedButtonLabel,
  closeImagePickerLabel,
  availableImagesLabel,
  emptyImageMessage,
}: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastMarkdownRef = useRef(value);
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);

  useEffect(() => {
    const nextValue = value ?? "";
    if (!editorRef.current || nextValue === lastMarkdownRef.current) return;

    if (editorRef.current.getMarkdown() !== nextValue) {
      editorRef.current.setMarkdown(nextValue);
    }
    lastMarkdownRef.current = nextValue;
  }, [value]);

  const handleInsertImage = (image: MarkdownEditorImage) => {
    if (!editorRef.current) return;

    editorRef.current.focus(undefined, {
      defaultSelection: "rootEnd",
      preventScroll: true,
    });
    editorRef.current.insertMarkdown(
      `\n![${getImageAltText(image.label)}](${image.url})\n`,
    );
    setIsImagePickerOpen(false);
  };

  const imagePickerButtonLabel = isImagePickerOpen
    ? closeImagePickerLabel
    : embedButtonLabel;

  return (
    <div className="mdx-editor-input overflow-hidden rounded-xl border border-border bg-surface">
      <MDXEditor
        ref={editorRef}
        markdown={value}
        readOnly={readOnly}
        spellCheck
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="mdx-editor-input__root"
        contentEditableClassName="mdx-editor-input__content"
        onChange={(nextMarkdown) => {
          lastMarkdownRef.current = nextMarkdown;
          onChange(nextMarkdown);
        }}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          linkPlugin(),
          quotePlugin(),
          markdownShortcutPlugin(),
          imagePlugin({
            imageAutocompleteSuggestions: availableImages.map(
              (image) => image.url,
            ),
          }),
          toolbarPlugin({
            toolbarClassName: "mdx-editor-input__toolbar",
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <button
                  type="button"
                  onClick={() => setIsImagePickerOpen((current) => !current)}
                  disabled={readOnly || availableImages.length === 0}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-sm font-medium text-muted transition hover:border-brand-border hover:text-foreground disabled:cursor-not-allowed disabled:text-muted/70"
                  title={imagePickerButtonLabel}
                  aria-label={imagePickerButtonLabel}
                >
                  {imageButtonLabel}
                </button>
              </>
            ),
          }),
        ]}
      />

      <div className="border-t border-border bg-surface-subtle px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsImagePickerOpen((current) => !current)}
            disabled={readOnly || availableImages.length === 0}
            className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted-strong transition hover:border-brand-border hover:text-foreground disabled:cursor-not-allowed disabled:text-muted/70"
          >
            {imagePickerButtonLabel}
          </button>
          <p className="text-xs text-muted">
            {availableImages.length > 0
              ? availableImagesLabel
              : emptyImageMessage}
          </p>
        </div>

        {isImagePickerOpen && availableImages.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableImages.map((image) => (
              <button
                key={image.url}
                type="button"
                onClick={() => handleInsertImage(image)}
                className="overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-brand-border hover:shadow-sm"
              >
                {/* Stored image URLs are authenticated same-origin routes. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnailUrl ?? image.url}
                  alt={image.label}
                  className="h-28 w-full object-cover"
                />
                <span className="block truncate px-3 py-2 text-xs font-medium text-foreground">
                  {image.label}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

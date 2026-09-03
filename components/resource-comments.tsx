"use client";

import {
  Check,
  Eye,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { MarkdownContent } from "@/components/markdown-content";
import { fetchJson } from "@/lib/client-types";
import { RESOURCE_COMMENT_MAX_LENGTH } from "@/lib/resource-comment-contract";

const initialsFor = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("") || "?";

type ClientComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

const hasBeenEdited = (comment: ClientComment) =>
  comment.updatedAt !== comment.createdAt;

export function CommentsThread({
  endpoint,
  canComment,
  embedded = false,
}: {
  endpoint: string;
  canComment: boolean;
  embedded?: boolean;
}) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [body, setBody] = useState("");
  const [composerMode, setComposerMode] = useState<"write" | "preview">(
    "write",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<{ comments: ClientComment[] }>(
        endpoint,
        { cache: "no-store" },
      );
      setComments(result.comments);
    } catch {
      setError(t("details.comments.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await fetchJson<{ comment: ClientComment }>(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      setComments((current) => [...current, result.comment]);
      setBody("");
      setComposerMode("write");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("details.comments.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (comment: ClientComment) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
    setError(null);
  };

  const saveEdit = async (commentId: string) => {
    if (!editBody.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await fetchJson<{ comment: ClientComment }>(
        `${endpoint}/${commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: editBody }),
        },
      );
      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId ? result.comment : comment,
        ),
      );
      setEditingId(null);
      setEditBody("");
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : t("details.comments.errors.update"),
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (
      deletingId ||
      !window.confirm(t("details.comments.confirmDelete"))
    ) {
      return;
    }
    setDeletingId(commentId);
    setError(null);
    try {
      await fetchJson(
        `${endpoint}/${commentId}`,
        { method: "DELETE" },
      );
      setComments((current) =>
        current.filter((comment) => comment.id !== commentId),
      );
      if (editingId === commentId) {
        setEditingId(null);
        setEditBody("");
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("details.comments.errors.delete"),
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section
      className={
        embedded
          ? "w-full"
          : "mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8"
      }
    >
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MessageSquareText className="size-4 text-brand" aria-hidden="true" />
              {t("details.comments.title")}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {t("details.comments.count", {
                count: comments.length,
                value: numberFormatter.format(comments.length),
              })}
            </p>
          </div>
        </header>

        {canComment ? (
          <form
            onSubmit={submitComment}
            className="border-b border-border bg-surface-subtle p-5 sm:p-6"
          >
            <div className="overflow-hidden rounded-xl border border-border bg-surface focus-within:border-brand-border focus-within:ring-4 focus-within:ring-brand-border/25">
              <div className="flex items-center gap-1 border-b border-border bg-surface-subtle p-1.5">
                <button
                  type="button"
                  onClick={() => setComposerMode("write")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    composerMode === "write"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                  aria-pressed={composerMode === "write"}
                >
                  <Pencil className="mr-1.5 inline size-3.5" aria-hidden="true" />
                  {t("details.comments.write")}
                </button>
                <button
                  type="button"
                  onClick={() => setComposerMode("preview")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    composerMode === "preview"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                  aria-pressed={composerMode === "preview"}
                >
                  <Eye className="mr-1.5 inline size-3.5" aria-hidden="true" />
                  {t("details.comments.preview")}
                </button>
              </div>
              {composerMode === "write" ? (
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={RESOURCE_COMMENT_MAX_LENGTH}
                  rows={5}
                  placeholder={t("details.comments.placeholder")}
                  aria-label={t("details.comments.inputLabel")}
                  className="block min-h-32 w-full resize-y bg-surface px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted"
                />
              ) : (
                <div className="min-h-32 px-4 py-3">
                  {body.trim() ? (
                    <MarkdownContent
                      value={body}
                      className="[&>*:last-child]:mb-0"
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      {t("details.comments.emptyPreview")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {t("details.comments.markdownHelp")}
                <span className="ml-2 font-mono">
                  {numberFormatter.format(body.length)} / {numberFormatter.format(RESOURCE_COMMENT_MAX_LENGTH)}
                </span>
              </p>
              <button
                type="submit"
                disabled={!body.trim() || saving}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
              >
                {saving ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-3.5" aria-hidden="true" />
                )}
                {saving
                  ? t("details.comments.posting")
                  : t("details.comments.post")}
              </button>
            </div>
          </form>
        ) : null}

        {error ? (
          <div
            className="mx-5 mt-5 flex items-center justify-between gap-4 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger sm:mx-6"
            role="alert"
          >
            <span>{error}</span>
            {loading ? null : (
              <button
                type="button"
                onClick={() => void loadComments()}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                {t("details.comments.retry")}
              </button>
            )}
          </div>
        ) : null}

        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="grid min-h-36 place-items-center text-muted">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              <span className="sr-only">{t("details.comments.loading")}</span>
            </div>
          ) : comments.length === 0 ? (
            <div className="px-5 py-10 text-center sm:px-6">
              <MessageSquareText
                className="mx-auto size-8 text-muted"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-semibold text-foreground">
                {t("details.comments.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("details.comments.emptyDescription")}
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border px-5 sm:px-6">
              {comments.map((comment) => (
                <li key={comment.id} className="py-5">
                  <article>
                    <header className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand ring-1 ring-inset ring-brand-border"
                          aria-hidden="true"
                        >
                          {initialsFor(comment.authorName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {comment.authorName}
                          </p>
                          <p className="mt-0.5 text-[13px] text-muted">
                            <time dateTime={comment.createdAt}>
                              {dateFormatter.format(new Date(comment.createdAt))}
                            </time>
                            {hasBeenEdited(comment)
                              ? ` · ${t("details.comments.edited")}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      {comment.canEdit && editingId !== comment.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditing(comment)}
                            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
                            aria-label={t("details.comments.edit")}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteComment(comment.id)}
                            disabled={deletingId === comment.id}
                            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                            aria-label={t("details.comments.delete")}
                          >
                            {deletingId === comment.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      ) : null}
                    </header>

                    {editingId === comment.id ? (
                      <div className="mt-4">
                        <textarea
                          value={editBody}
                          onChange={(event) => setEditBody(event.target.value)}
                          maxLength={RESOURCE_COMMENT_MAX_LENGTH}
                          rows={5}
                          aria-label={t("details.comments.editInputLabel")}
                          className="block min-h-28 w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground outline-none transition focus:border-brand-border focus:ring-4 focus:ring-brand-border/25"
                        />
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditBody("");
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-muted transition hover:bg-surface-hover hover:text-foreground"
                          >
                            <X className="size-3.5" aria-hidden="true" />
                            {t("details.comments.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(comment.id)}
                            disabled={!editBody.trim() || saving}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-xs font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {saving ? (
                              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="size-3.5" aria-hidden="true" />
                            )}
                            {t("details.comments.save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <MarkdownContent
                        value={comment.body}
                        className="mt-4 pl-12 [&>*:last-child]:mb-0"
                      />
                    )}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

export function ResourceComments({
  resourceId,
  canComment,
}: {
  resourceId: string;
  canComment: boolean;
}) {
  return (
    <CommentsThread
      endpoint={`/api/v1/resources/${resourceId}/comments`}
      canComment={canComment}
    />
  );
}

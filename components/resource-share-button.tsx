"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

type ItemPublicShare = {
  id: string;
  name: string;
  scope: "inventory" | "item";
  resourceId: string | null;
  createdAt: string;
};

function errorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ResourceShareButton({
  resourceId,
  resourceName,
}: {
  resourceId: string;
  resourceName: string;
}) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const defaultShareName = resourceName.trim().slice(0, 120);
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ItemPublicShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(defaultShareName);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setActionError(null);

    void fetch("/api/v1/public-shares", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { shares?: ItemPublicShare[]; error?: string }
          | null;
        if (!response.ok) {
          throw new Error(
            errorMessage(payload, t("details.share.errors.load")),
          );
        }
        return payload?.shares ?? [];
      })
      .then((items) => {
        if (controller.signal.aborted) return;
        setShares(
          items.filter(
            (share) =>
              share.scope === "item" && share.resourceId === resourceId,
          ),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : t("details.share.errors.load"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, reloadVersion, resourceId, t]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !dialog.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  function openDialog() {
    setName(defaultShareName);
    setFormError(null);
    setActionError(null);
    setConfirmRevoke(null);
    setOpen(true);
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    setFormError(null);
    setActionError(null);
    if (!trimmedName) {
      setFormError(t("details.share.errors.nameRequired"));
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/v1/public-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "item",
          name: trimmedName,
          resourceId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { share?: ItemPublicShare; error?: string }
        | null;
      if (!response.ok || !payload?.share) {
        throw new Error(
          errorMessage(payload, t("details.share.errors.create")),
        );
      }
      const createdShare = payload.share;
      setShares((current) => [createdShare, ...current]);
      setName(defaultShareName);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : t("details.share.errors.create"),
      );
    } finally {
      setCreating(false);
    }
  }

  async function copyShareLink(shareId: string) {
    setActionError(null);
    try {
      const url = new URL(`/share/${shareId}`, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      setCopiedId(shareId);
      window.setTimeout(
        () =>
          setCopiedId((current) => (current === shareId ? null : current)),
        2_000,
      );
    } catch {
      setActionError(t("details.share.errors.clipboard"));
    }
  }

  async function revokeShare(shareId: string) {
    setRevokingId(shareId);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/v1/public-shares/${encodeURIComponent(shareId)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, t("details.share.errors.revoke")),
        );
      }
      setShares((current) =>
        current.filter((share) => share.id !== shareId),
      );
      setConfirmRevoke(null);
      setCopiedId((current) => (current === shareId ? null : current));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : t("details.share.errors.revoke"),
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-muted-strong shadow-sm transition hover:border-border-strong hover:bg-surface-subtle hover:text-foreground"
      >
        <Share2 className="size-4" aria-hidden="true" />
        {t("details.actions.share")}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-overlay p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-share-title"
            tabIndex={-1}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Share2 className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="resource-share-title"
                    className="text-lg font-semibold tracking-[-0.02em] text-foreground"
                  >
                    {t("details.share.title")}
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    {t("details.share.description", { name: resourceName })}
                  </p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-surface-muted hover:text-foreground"
                aria-label={t("details.share.close")}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <form
                onSubmit={(event) => void createShare(event)}
                className="rounded-2xl border border-border bg-surface-subtle p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-muted shadow-sm">
                    <Plus className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("details.share.createTitle")}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {t("details.share.createDescription")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 text-xs font-semibold text-muted-strong">
                    {t("details.share.nameLabel")}
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={120}
                      autoComplete="off"
                      className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={creating || loading || !name.trim()}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? (
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Link2 className="size-4" aria-hidden="true" />
                    )}
                    {creating
                      ? t("details.share.creating")
                      : t("details.share.create")}
                  </button>
                </div>
                {formError ? (
                  <p className="mt-3 text-xs text-danger" role="alert">
                    {formError}
                  </p>
                ) : null}
              </form>

              <section className="mt-6" aria-labelledby="item-public-links-title">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h3
                      id="item-public-links-title"
                      className="text-sm font-semibold text-foreground"
                    >
                      {t("details.share.existingTitle")}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {t("details.share.existingDescription")}
                    </p>
                  </div>
                  {!loading && !loadError ? (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted-strong">
                      {shares.length}
                    </span>
                  ) : null}
                </div>

                {actionError ? (
                  <p
                    className="mt-4 rounded-xl border border-danger-border bg-danger-soft px-3.5 py-3 text-xs text-danger"
                    role="alert"
                  >
                    {actionError}
                  </p>
                ) : null}

                {loading ? (
                  <div
                    className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border px-4 py-10 text-sm text-muted"
                    aria-label={t("details.share.loading")}
                  >
                    <LoaderCircle className="size-4 animate-spin" />
                    {t("details.share.loading")}
                  </div>
                ) : loadError ? (
                  <div className="mt-4 rounded-2xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
                    <p>{loadError}</p>
                    <button
                      type="button"
                      onClick={() => setReloadVersion((current) => current + 1)}
                      className="mt-3 font-semibold underline underline-offset-4"
                    >
                      {t("details.share.retry")}
                    </button>
                  </div>
                ) : shares.length ? (
                  <div className="mt-4 space-y-3">
                    {shares.map((share) => {
                      const confirming = confirmRevoke === share.id;
                      const revoking = revokingId === share.id;
                      return (
                        <article
                          key={share.id}
                          className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
                              <Link2 className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {share.name}
                              </p>
                              <p className="mt-1 truncate font-mono text-[10px] text-muted">
                                /share/{share.id}
                              </p>
                              <p className="mt-1 text-[10px] text-muted">
                                {t("details.share.created", {
                                  date: formatDate(share.createdAt, locale),
                                })}
                              </p>
                            </div>
                          </div>

                          {confirming ? (
                            <div className="mt-4 rounded-xl border border-danger-border bg-danger-soft p-3">
                              <p className="text-xs leading-5 text-danger">
                                {t("details.share.revokeConfirmation")}
                              </p>
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setConfirmRevoke(null)}
                                  disabled={revoking}
                                  className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-muted-strong hover:bg-surface"
                                >
                                  {t("details.share.cancel")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void revokeShare(share.id)}
                                  disabled={revoking}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-danger px-3 text-xs font-semibold text-on-strong disabled:opacity-50"
                                >
                                  {revoking ? (
                                    <LoaderCircle
                                      className="size-3.5 animate-spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Trash2
                                      className="size-3.5"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {revoking
                                    ? t("details.share.revoking")
                                    : t("details.share.confirmRevoke")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                              <button
                                type="button"
                                onClick={() => void copyShareLink(share.id)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-strong transition hover:border-border-strong hover:text-foreground"
                              >
                                {copiedId === share.id ? (
                                  <Check
                                    className="size-3.5 text-success"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Copy className="size-3.5" aria-hidden="true" />
                                )}
                                {copiedId === share.id
                                  ? t("details.share.copied")
                                  : t("details.share.copy")}
                              </button>
                              <a
                                href={`/share/${share.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-strong transition hover:border-border-strong hover:text-foreground"
                              >
                                <ExternalLink
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                {t("details.share.open")}
                              </a>
                              <button
                                type="button"
                                onClick={() => setConfirmRevoke(share.id)}
                                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-danger transition hover:bg-danger-soft"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                                {t("details.share.revoke")}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-border-strong px-5 py-8 text-center">
                    <Link2 className="mx-auto size-6 text-muted" aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {t("details.share.emptyTitle")}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">
                      {t("details.share.emptyDescription")}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

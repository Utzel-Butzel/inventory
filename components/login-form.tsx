"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import { useT } from "next-i18next/client";

import { Button } from "@/components/ui";

export function LoginForm({
  auth0Enabled,
  callbackUrl = "/dashboard",
}: {
  auth0Enabled: boolean;
  callbackUrl?: string;
}) {
  const router = useRouter();
  const { t } = useT("auth");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        redirectTo: callbackUrl,
      });

      if (!result?.ok) {
        setError("form.errors.invalidCredentials");
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("form.errors.connection");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAuth0() {
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn("auth0", { redirectTo: callbackUrl });
    } catch {
      setError("form.errors.auth0");
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-[13px] font-medium text-muted-strong"
          >
            {t("form.email.label")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            required
            placeholder={t("form.email.placeholder")}
            className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:outline-none focus:ring-4 focus:ring-focus/10"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-muted-strong"
            >
              {t("form.password.label")}
            </label>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder={t("form.password.placeholder")}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 pr-11 text-sm text-foreground shadow-sm transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:outline-none focus:ring-4 focus:ring-focus/10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted transition hover:text-foreground"
              aria-label={
                showPassword
                  ? t("form.password.hide")
                  : t("form.password.show")
              }
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-danger-border bg-danger-soft px-3.5 py-3 text-[13px] leading-5 text-danger"
          >
            {t(error)}
          </div>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-4" aria-hidden="true" />
          )}
          {t("form.submit")}
          {!isSubmitting ? (
            <ArrowRight className="ml-auto size-4" aria-hidden="true" />
          ) : null}
        </Button>
      </form>

      {auth0Enabled ? (
        <div className="mt-5">
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            {t("form.separator")}
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="mt-5 w-full"
            onClick={handleAuth0}
            disabled={isSubmitting}
          >
            <span className="grid size-5 place-items-center rounded-md bg-strong text-[10px] font-bold text-on-strong">
              {t("form.ssoBadge")}
            </span>
            {t("form.auth0")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

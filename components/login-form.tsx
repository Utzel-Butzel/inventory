"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui";

export function LoginForm({
  auth0Enabled,
  callbackUrl = "/dashboard",
}: {
  auth0Enabled: boolean;
  callbackUrl?: string;
}) {
  const router = useRouter();
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
        setError("Email or password is incorrect. Please try again.");
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("We couldn’t sign you in. Check your connection and try again.");
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
      setError("Auth0 sign-in could not be started. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-[13px] font-medium text-[#42464d]"
          >
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            required
            placeholder="you@company.com"
            className="h-11 w-full rounded-xl border border-[#dfe2e7] bg-white px-3.5 text-sm text-[#24272b] shadow-sm transition placeholder:text-[#5f6672] hover:border-[#cdd1d8] focus:border-[#776fff] focus:outline-none focus:ring-4 focus:ring-[#635bff]/10"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-[#42464d]"
            >
              Password
            </label>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="Enter your password"
              className="h-11 w-full rounded-xl border border-[#dfe2e7] bg-white px-3.5 pr-11 text-sm text-[#24272b] shadow-sm transition placeholder:text-[#5f6672] hover:border-[#cdd1d8] focus:border-[#776fff] focus:outline-none focus:ring-4 focus:ring-[#635bff]/10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-[#5f6672] transition hover:text-[#30343a]"
              aria-label={showPassword ? "Hide password" : "Show password"}
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
            className="rounded-xl border border-[#f1c8ce] bg-[#fff5f6] px-3.5 py-3 text-[13px] leading-5 text-[#ad3140]"
          >
            {error}
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
          Sign in
          {!isSubmitting ? (
            <ArrowRight className="ml-auto size-4" aria-hidden="true" />
          ) : null}
        </Button>
      </form>

      {auth0Enabled ? (
        <div className="mt-5">
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[#5f6672] before:h-px before:flex-1 before:bg-[#e8eaed] after:h-px after:flex-1 after:bg-[#e8eaed]">
            or
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="mt-5 w-full"
            onClick={handleAuth0}
            disabled={isSubmitting}
          >
            <span className="grid size-5 place-items-center rounded-md bg-[#1f2937] text-[10px] font-bold text-white">
              SSO
            </span>
            Continue with Auth0
          </Button>
        </div>
      ) : null}
    </div>
  );
}

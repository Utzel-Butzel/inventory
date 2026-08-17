import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { Inbox } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "border-transparent bg-brand-solid text-on-brand shadow-sm hover:bg-brand-hover active:bg-brand-active",
    secondary:
      "border-border bg-surface text-foreground shadow-sm hover:border-border-strong hover:bg-surface-subtle active:bg-surface-muted",
    ghost:
      "border-transparent bg-transparent text-muted-strong hover:bg-surface-muted hover:text-foreground",
    danger:
      "border-danger-border bg-surface text-danger shadow-sm hover:bg-danger-soft",
  };
  const sizes = {
    sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px] font-medium",
    md: "h-10 gap-2 rounded-xl px-4 text-sm font-semibold",
    lg: "h-12 gap-2 rounded-xl px-5 text-[15px] font-semibold",
  };

  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border transition duration-150 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-muted text-muted-strong",
    brand: "bg-brand-soft text-brand",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };

  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-lg bg-surface-muted before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-surface/70 before:to-transparent",
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center",
        className,
      )}
    >
      <div className="mb-3 grid size-10 place-items-center rounded-lg bg-surface-subtle text-muted">
        {icon ?? <Inbox className="size-5" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-muted">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

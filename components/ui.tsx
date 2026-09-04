import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { AlertCircle, CircleCheck, Inbox, Info, TriangleAlert } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
};

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-brand-solid text-on-brand shadow-sm hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "border-border bg-surface text-foreground shadow-sm hover:border-border-strong hover:bg-surface-subtle active:bg-surface-muted",
  ghost:
    "border-transparent bg-transparent text-muted-strong hover:bg-surface-muted hover:text-foreground",
  danger:
    "border-danger-border bg-surface text-danger shadow-sm hover:bg-danger-soft",
  "danger-ghost":
    "border-transparent bg-transparent text-muted hover:bg-danger-soft hover:text-danger",
};

const buttonSizeClasses = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[14px] font-medium",
  md: "h-10 gap-2 rounded-xl px-4 text-sm font-semibold",
  lg: "h-12 gap-2 rounded-xl px-5 text-[16px] font-semibold",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border transition duration-150 disabled:pointer-events-none disabled:opacity-50",
        buttonVariantClasses[variant],
        buttonSizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> & {
  "aria-label": string;
  size?: "sm" | "md" | "lg";
  variant?: ButtonVariant;
};

export function IconButton({
  className,
  size = "md",
  type = "button",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  const sizes = {
    sm: "size-8 rounded-lg",
    md: "size-10 rounded-xl",
    lg: "size-12 rounded-xl",
  };

  return (
    <button
      type={type}
      className={cn(
        "inline-grid shrink-0 place-items-center border transition duration-150 disabled:pointer-events-none disabled:opacity-50",
        buttonVariantClasses[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

type AlertTone = "info" | "success" | "warning" | "danger";

const alertToneClasses: Record<AlertTone, string> = {
  info: "border-info-border bg-info-soft text-info",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
};

const alertIcons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: AlertCircle,
};

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  icon?: ReactNode | false;
  tone?: AlertTone;
};

export function Alert({
  action,
  children,
  className,
  icon,
  role,
  tone = "info",
  ...props
}: AlertProps) {
  const DefaultIcon = alertIcons[tone];
  const defaultRole = tone === "danger" || tone === "warning" ? "alert" : "status";

  return (
    <div
      role={role ?? defaultRole}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
        alertToneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon === false ? null : (
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {icon ?? <DefaultIcon className="size-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
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
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold tracking-[0.01em]",
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
      <p className="mt-1.5 max-w-sm text-[14px] leading-5 text-muted">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

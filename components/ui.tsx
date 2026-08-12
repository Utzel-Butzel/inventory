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
      "border-transparent bg-[#5147d9] text-white shadow-sm hover:bg-[#5147f5] active:bg-[#443be0]",
    secondary:
      "border-[#dfe2e7] bg-white text-[#282b31] shadow-sm hover:border-[#cfd3da] hover:bg-[#fafafa] active:bg-[#f3f4f6]",
    ghost:
      "border-transparent bg-transparent text-[#555c67] hover:bg-[#f0f2f4] hover:text-[#25282d]",
    danger:
      "border-[#f1c7cc] bg-white text-[#b83243] shadow-sm hover:bg-[#fff5f6]",
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
    neutral: "bg-[#f0f2f4] text-[#555c67]",
    brand: "bg-[#eeedff] text-[#5147d9]",
    success: "bg-[#e8f7f0] text-[#11734d]",
    warning: "bg-[#fff2e2] text-[#9b5300]",
    danger: "bg-[#fff0f2] text-[#b83243]",
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
        "rounded-2xl border border-[#e4e7eb] bg-white shadow-[var(--shadow-sm)]",
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
        "relative overflow-hidden rounded-lg bg-[#eceef1] before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent",
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
        "flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-11 place-items-center rounded-xl border border-[#e1e4e8] bg-[#f8f9fa] text-[#5f6672] shadow-sm">
        {icon ?? <Inbox className="size-5" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-semibold text-[#292c31]">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-[#5f6672]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

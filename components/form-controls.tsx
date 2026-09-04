"use client";

import {
  createContext,
  useContext,
  useId,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { LoaderCircle, Search, X } from "lucide-react";

import { IconButton, cn } from "@/components/ui";

type ControlSize = "sm" | "md" | "lg";

type FieldContextValue = {
  controlId: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

const controlBaseClass =
  "w-full border border-border bg-surface text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted aria-invalid:border-danger-border aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/10";

const controlSizeClasses: Record<ControlSize, string> = {
  sm: "h-9 rounded-lg px-2.5 text-[13px]",
  md: "h-10 rounded-xl px-3 text-sm",
  lg: "h-11 rounded-xl px-3.5 text-sm",
};

const textareaSizeClasses: Record<ControlSize, string> = {
  sm: "min-h-20 rounded-lg px-2.5 py-2 text-[13px] leading-5",
  md: "min-h-24 rounded-xl px-3 py-2.5 text-sm leading-5",
  lg: "min-h-28 rounded-xl px-3.5 py-3 text-sm leading-6",
};

function describedBy(
  ownDescription: string | undefined,
  field: FieldContextValue | null,
) {
  const ids = [ownDescription, field?.descriptionId, field?.errorId].filter(
    Boolean,
  );
  return ids.length ? ids.join(" ") : undefined;
}

type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  controlId?: string;
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  optionalLabel?: ReactNode;
  required?: boolean;
};

export function Field({
  children,
  className,
  controlId: suppliedControlId,
  description,
  error,
  label,
  optionalLabel,
  required = false,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const controlId = suppliedControlId ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  return (
    <FieldContext.Provider
      value={{
        controlId,
        descriptionId,
        errorId,
        invalid: Boolean(error),
        required,
      }}
    >
      <div className={cn("min-w-0", className)} {...props}>
        <label
          className="block text-[12px] font-semibold text-muted-strong"
          htmlFor={controlId}
        >
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              {" "}*
            </span>
          ) : null}
          {optionalLabel ? (
            <span className="font-normal text-muted">
              {" "}· {optionalLabel}
            </span>
          ) : null}
        </label>
        <div className="mt-1.5">{children}</div>
        {description ? (
          <p id={descriptionId} className="mt-1.5 text-[12px] leading-4 text-muted">
            {description}
          </p>
        ) : null}
        {error ? (
          <p
            id={errorId}
            className="mt-1.5 text-[12px] leading-4 text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export type InputProps = ComponentPropsWithRef<"input"> & {
  controlSize?: ControlSize;
};

export function Input({
  className,
  controlSize = "md",
  id,
  required,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  const field = useContext(FieldContext);

  return (
    <input
      id={id ?? field?.controlId}
      aria-describedby={describedBy(ariaDescribedBy, field)}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      required={required ?? field?.required}
      className={cn(controlBaseClass, controlSizeClasses[controlSize], className)}
      {...props}
    />
  );
}

type SelectProps = ComponentPropsWithRef<"select"> & {
  controlSize?: ControlSize;
};

export function Select({
  className,
  controlSize = "md",
  id,
  required,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: SelectProps) {
  const field = useContext(FieldContext);

  return (
    <select
      id={id ?? field?.controlId}
      aria-describedby={describedBy(ariaDescribedBy, field)}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      required={required ?? field?.required}
      className={cn(
        controlBaseClass,
        controlSizeClasses[controlSize],
        "pr-9",
        className,
      )}
      {...props}
    />
  );
}

type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  controlSize?: ControlSize;
};

export function Textarea({
  className,
  controlSize = "md",
  id,
  required,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  const field = useContext(FieldContext);

  return (
    <textarea
      id={id ?? field?.controlId}
      aria-describedby={describedBy(ariaDescribedBy, field)}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      required={required ?? field?.required}
      className={cn(
        controlBaseClass,
        textareaSizeClasses[controlSize],
        "resize-y",
        className,
      )}
      {...props}
    />
  );
}

type SearchActionProps =
  | {
      clearLabel: string;
      onClear: () => void;
    }
  | {
      clearLabel?: undefined;
      onClear?: undefined;
    };

export type SearchInputProps = Omit<InputProps, "type"> &
  SearchActionProps & {
    containerClassName?: string;
    loading?: boolean;
  };

export function SearchInput({
  className,
  clearLabel,
  containerClassName,
  loading = false,
  onClear,
  value,
  ...props
}: SearchInputProps) {
  const hasValue =
    (typeof value === "string" || typeof value === "number") &&
    String(value).length > 0;

  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        className={cn(
          "pl-9",
          (loading || (onClear && hasValue)) && "pr-10",
          className,
        )}
        {...props}
      />
      {loading ? (
        <LoaderCircle
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand"
          aria-hidden="true"
        />
      ) : onClear && hasValue ? (
        <IconButton
          size="sm"
          onClick={onClear}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          aria-label={clearLabel}
        >
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}

export type NumberInputProps = Omit<InputProps, "type"> & {
  containerClassName?: string;
  unit?: ReactNode;
};

export function NumberInput({
  className,
  containerClassName,
  inputMode = "decimal",
  unit,
  ...props
}: NumberInputProps) {
  if (!unit) {
    return (
      <Input
        type="number"
        inputMode={inputMode}
        className={className}
        {...props}
      />
    );
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        type="number"
        inputMode={inputMode}
        className={cn("pr-16", className)}
        {...props}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted">
        {unit}
      </span>
    </div>
  );
}

export type CurrencyInputProps = Omit<NumberInputProps, "unit"> & {
  currency: string;
};

export function CurrencyInput({
  currency,
  min = "0",
  step = "0.01",
  ...props
}: CurrencyInputProps) {
  return <NumberInput min={min} step={step} unit={currency} {...props} />;
}

export function FormActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

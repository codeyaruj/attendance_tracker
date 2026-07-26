import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "border-border bg-surface text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:ring-primary/20 disabled:bg-secondary min-h-11 w-full rounded-xl border px-3.5 text-base outline-none focus:ring-2 disabled:cursor-not-allowed sm:text-sm",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "border-border bg-surface text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:ring-primary/20 min-h-28 w-full resize-y rounded-xl border px-3.5 py-3 text-base outline-none focus:ring-2 sm:text-sm",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "border-border bg-surface text-foreground focus:border-primary focus:ring-primary/20 min-h-11 w-full rounded-xl border px-3.5 text-base outline-none focus:ring-2 sm:text-sm",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-foreground grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
      {error ? (
        <span className="text-danger-strong text-xs">{error}</span>
      ) : hint ? (
        <span className="text-muted-foreground text-xs font-normal">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="border-border bg-surface flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-3.5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="bg-border peer-checked:bg-primary peer-focus-visible:ring-primary relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 before:absolute before:top-1 before:left-1 before:size-5 before:rounded-full before:bg-white before:shadow before:transition-transform peer-checked:before:translate-x-5" />
    </label>
  );
}

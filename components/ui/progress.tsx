import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  indicatorClassName,
  label,
}: {
  value: number;
  className?: string;
  indicatorClassName?: string;
  label: string;
}) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeValue)}
      className={cn("bg-secondary h-2 overflow-hidden rounded-full", className)}
    >
      <div
        className={cn(
          "bg-primary h-full rounded-full transition-[width]",
          indicatorClassName,
        )}
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

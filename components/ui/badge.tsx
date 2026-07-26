import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "safe" | "caution" | "danger" | "neutral" | "info";

const tones: Record<BadgeTone, string> = {
  safe: "bg-safe-soft text-safe-strong",
  caution: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  neutral: "bg-secondary text-muted-foreground",
  info: "bg-info-soft text-info-strong",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

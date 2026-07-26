import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/dashboard"
      className="focus-visible:ring-primary inline-flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      aria-label="AttendSafe dashboard"
    >
      <span className="bg-primary text-primary-foreground relative grid size-10 shrink-0 place-items-center rounded-[14px] text-lg font-black shadow-sm">
        A
        <span className="border-surface absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 bg-[#f1b84b]" />
      </span>
      <span
        className={cn(
          "font-display text-xl font-extrabold tracking-[-0.04em]",
          compact && "sr-only",
        )}
      >
        Attend<span className="text-primary">Safe</span>
      </span>
    </Link>
  );
}

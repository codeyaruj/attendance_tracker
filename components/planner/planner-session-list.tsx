import { CalendarClock, MapPin } from "lucide-react";

import { formatClockTime } from "@/components/attendance/attendance-view-model";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResolvedSession, Subject } from "@/types/domain";

import { formatPlannerDate } from "./planner-model";

export function PlannerSessionList({
  sessions,
  subjectsById,
  selectedIds,
  onToggle,
  emptyMessage = "No eligible classes in this period.",
  maxHeight = true,
}: {
  sessions: readonly ResolvedSession[];
  subjectsById: ReadonlyMap<string, Subject>;
  selectedIds: ReadonlySet<string>;
  onToggle: (sessionId: string) => void;
  emptyMessage?: string;
  maxHeight?: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-2",
        maxHeight && "max-h-[27rem] overflow-y-auto pr-1",
      )}
      aria-label="Upcoming classes"
    >
      {sessions.map((session) => {
        const subject = subjectsById.get(session.subjectId);
        const selected = selectedIds.has(session.id);
        return (
          <label
            key={session.id}
            className={cn(
              "focus-within:ring-primary flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors focus-within:ring-2",
              selected
                ? "border-primary bg-primary-soft"
                : "border-border bg-surface hover:border-primary/40",
            )}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(session.id)}
              className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
              aria-label={`Select ${subject?.name ?? "class"} on ${formatPlannerDate(session.date)}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {subject?.name ?? "Unknown subject"}
                </span>
                {subject?.code ? <Badge>{subject.code}</Badge> : null}
              </span>
              <span className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  {formatPlannerDate(session.date)} ·{" "}
                  {formatClockTime(session.startTime)}
                </span>
                {session.room ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {session.room}
                  </span>
                ) : null}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

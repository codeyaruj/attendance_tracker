"use client";

import { AlertTriangle, Plus } from "lucide-react";
import { formatClockTime } from "@/components/attendance/attendance-view-model";
import { Badge } from "@/components/ui/badge";
import {
  buildWeeklyTimetableMatrix,
  type WeeklyGridTimeColumn,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import type { DayOfWeek } from "@/types";

export interface WeeklyTimetableEntry {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  title: string;
  subjectName?: string;
  faculty?: string[];
  room?: string;
  qualifiers?: string[];
  isBreak?: boolean;
  isPlaceholder?: boolean;
  warning?: boolean;
  lowConfidence?: boolean;
  active?: boolean;
}

function titleCase(day: DayOfWeek): string {
  return day[0] + day.slice(1).toLowerCase();
}

function sessionLabel(entry: WeeklyTimetableEntry): string {
  const qualifiers = entry.qualifiers?.length
    ? `, ${entry.qualifiers.join(", ")}`
    : "";
  return `${entry.title}, ${titleCase(entry.dayOfWeek)}, ${formatClockTime(entry.startTime)} to ${formatClockTime(entry.endTime)}${qualifiers}`;
}

export function WeeklyTimetableGrid({
  entries,
  days,
  timeSlots,
  onSessionSelect,
  onEmptySelect,
  ariaLabel = "Weekly timetable",
  describedBy,
  className,
}: {
  entries: WeeklyTimetableEntry[];
  days?: readonly DayOfWeek[];
  timeSlots?: readonly WeeklyGridTimeColumn[];
  onSessionSelect?: (entry: WeeklyTimetableEntry) => void;
  onEmptySelect?: (day: DayOfWeek, startTime: string) => void;
  ariaLabel?: string;
  describedBy?: string;
  className?: string;
}) {
  const matrix = buildWeeklyTimetableMatrix(entries, { days, timeSlots });
  const templateColumns = `7rem repeat(${matrix.columns.length}, minmax(9rem, 1fr))`;

  return (
    <section
      className={cn(
        "border-border bg-surface max-w-full overflow-hidden rounded-2xl border",
        className,
      )}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      data-testid="weekly-timetable-grid"
    >
      <div
        className="scrollbar-none max-h-[70vh] overflow-auto overscroll-contain"
        tabIndex={0}
        data-testid="weekly-timetable-scroll"
      >
        <div
          className="min-w-max"
          role="table"
          aria-label={ariaLabel}
          style={{ minWidth: `${112 + matrix.columns.length * 144}px` }}
        >
          <div
            className="border-border bg-secondary sticky top-0 z-30 grid border-b"
            role="row"
            style={{ gridTemplateColumns: templateColumns }}
          >
            <div
              className="border-border bg-secondary sticky top-0 left-0 z-40 border-r p-3 text-xs font-extrabold tracking-wide uppercase"
              role="columnheader"
              data-testid="weekly-grid-corner"
            >
              Day / Time
            </div>
            {matrix.columns.map((column) => (
              <div
                key={`${column.startTime}-${column.endTime}`}
                className="border-border bg-secondary sticky top-0 z-30 border-r p-3 text-center text-xs font-bold whitespace-nowrap last:border-r-0"
                role="columnheader"
              >
                {formatClockTime(column.startTime)}–
                {formatClockTime(column.endTime)}
              </div>
            ))}
          </div>

          {matrix.days.map((day) => (
            <div
              key={day.dayOfWeek}
              className="border-border relative grid border-b last:border-b-0"
              role="row"
              style={{
                gridTemplateColumns: templateColumns,
                gridTemplateRows: `repeat(${day.laneCount}, minmax(5rem, auto))`,
              }}
            >
              <div
                className="border-border bg-surface sticky left-0 z-20 flex items-center border-r px-3 py-2 text-sm font-extrabold"
                role="rowheader"
                style={{
                  gridColumn: 1,
                  gridRow: `1 / span ${day.laneCount}`,
                }}
                data-testid={`weekly-grid-day-${day.dayOfWeek.toLowerCase()}`}
              >
                {titleCase(day.dayOfWeek)}
              </div>

              {matrix.columns.map((column, columnIndex) => (
                <div
                  key={`${day.dayOfWeek}-${column.startTime}`}
                  className="group border-border relative min-h-20 border-r last:border-r-0"
                  role="cell"
                  style={{
                    gridColumn: columnIndex + 2,
                    gridRow: `1 / span ${day.laneCount}`,
                  }}
                  data-testid={`weekly-grid-cell-${day.dayOfWeek.toLowerCase()}-${column.startTime}`}
                >
                  {onEmptySelect ? (
                    <button
                      type="button"
                      onClick={() =>
                        onEmptySelect(day.dayOfWeek, column.startTime)
                      }
                      className="text-muted-foreground focus-visible:ring-primary hover:bg-secondary/70 absolute inset-1 z-0 grid place-items-center rounded-lg opacity-0 transition group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={`Add ${titleCase(day.dayOfWeek)} class at ${formatClockTime(column.startTime)}`}
                    >
                      <Plus className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}

              {day.placements.map(
                ({ session, startColumn, columnSpan, lane }) => {
                  const content = (
                    <>
                      <span className="flex min-w-0 items-start justify-between gap-1">
                        <span className="truncate text-xs font-extrabold">
                          {session.isBreak ? "Break" : session.title}
                        </span>
                        {session.warning || session.lowConfidence ? (
                          <AlertTriangle
                            className="size-3.5 shrink-0"
                            aria-label={
                              session.lowConfidence
                                ? "Low-confidence timetable entry"
                                : "Time conflict"
                            }
                          />
                        ) : null}
                      </span>
                      {session.subjectName &&
                      session.subjectName !== session.title ? (
                        <span className="mt-0.5 block truncate text-[11px] font-semibold">
                          {session.subjectName}
                        </span>
                      ) : null}
                      {session.faculty?.length ? (
                        <span className="mt-1 block truncate text-[10px]">
                          {session.faculty.join(", ")}
                        </span>
                      ) : null}
                      {session.room ? (
                        <span className="block truncate text-[10px]">
                          {session.room}
                        </span>
                      ) : null}
                      {session.qualifiers?.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {session.qualifiers.map((qualifier) => (
                            <Badge
                              key={qualifier}
                              tone="info"
                              className="min-h-4 px-1.5 py-0 text-[9px]"
                            >
                              {qualifier}
                            </Badge>
                          ))}
                        </span>
                      ) : null}
                    </>
                  );
                  const sharedClassName = cn(
                    "border-primary/20 bg-primary-soft text-primary z-10 m-1 min-w-0 rounded-lg border p-2 text-left",
                    session.isBreak &&
                      "border-border bg-secondary text-muted-foreground",
                    session.isPlaceholder &&
                      "bg-warning-soft text-warning-strong border-dashed",
                    session.active &&
                      "ring-primary ring-offset-background ring-2 ring-offset-1",
                  );
                  const style = {
                    gridColumn: `${startColumn + 2} / span ${columnSpan}`,
                    gridRow: lane + 1,
                  };
                  return onSessionSelect ? (
                    <div
                      key={session.id}
                      className={sharedClassName}
                      style={style}
                      role="cell"
                      data-testid={`timetable-slot-${session.id}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSessionSelect(session)}
                        className="hover:border-primary/50 focus-visible:ring-primary h-full w-full rounded-md text-left transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none"
                        aria-label={sessionLabel(session)}
                      >
                        {content}
                      </button>
                    </div>
                  ) : (
                    <div
                      key={session.id}
                      className={sharedClassName}
                      style={style}
                      role="cell"
                      aria-label={sessionLabel(session)}
                      data-testid={`timetable-slot-${session.id}`}
                    >
                      {content}
                    </div>
                  );
                },
              )}
            </div>
          ))}
        </div>
      </div>
      {matrix.warnings.length ? (
        <div
          className="border-warning/30 bg-warning-soft text-warning-strong border-t px-3 py-2 text-xs"
          role="alert"
        >
          {matrix.warnings.join(" ")}
        </div>
      ) : null}
    </section>
  );
}

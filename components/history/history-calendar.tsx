"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { HistoryEntry } from "./history-view-model";

const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];

export function HistoryCalendar({
  entries,
  month,
  today,
  selectedStart,
  selectedEnd,
  minimumDate,
  maximumDate,
  onMonthChange,
  onSelectDate,
}: {
  entries: readonly HistoryEntry[];
  month: Date;
  today: string;
  selectedStart: string;
  selectedEnd: string;
  minimumDate?: string;
  maximumDate?: string;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: string) => void;
}) {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: first, end: last });
  const previousMonth = subMonths(month, 1);
  const nextMonth = addMonths(month, 1);
  const previousDisabled = Boolean(
    minimumDate &&
    format(endOfMonth(previousMonth), "yyyy-MM-dd") < minimumDate,
  );
  const nextDisabled = Boolean(
    maximumDate && format(startOfMonth(nextMonth), "yyyy-MM-dd") > maximumDate,
  );
  const activityByDate = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.isActivity) continue;
    activityByDate.set(
      entry.session.date,
      (activityByDate.get(entry.session.date) ?? 0) + 1,
    );
  }

  return (
    <Card className="p-4 sm:p-5" data-testid="history-calendar">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-primary text-xs font-bold tracking-[0.14em] uppercase">
            Calendar
          </p>
          <h2 className="font-display mt-1 text-lg font-extrabold">
            {format(month, "MMMM yyyy")}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMonthChange(previousMonth)}
            disabled={previousDisabled}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const date =
                maximumDate && today > maximumDate ? maximumDate : today;
              onMonthChange(parseISO(date));
              onSelectDate(date);
            }}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMonthChange(nextMonth)}
            disabled={nextDisabled}
            aria-label="Next month"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7" aria-hidden="true">
        {weekdayLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="text-muted-foreground py-2 text-center text-[11px] font-bold"
          >
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-1"
        role="grid"
        aria-label={format(month, "MMMM yyyy")}
      >
        {days.map((day) => {
          const date = format(day, "yyyy-MM-dd");
          const selected =
            Boolean(selectedStart) &&
            date >= selectedStart &&
            date <= (selectedEnd || selectedStart);
          const activity = activityByDate.get(date) ?? 0;
          const outsideAllowedRange = Boolean(
            (minimumDate && date < minimumDate) ||
            (maximumDate && date > maximumDate),
          );
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-label={`${format(day, "EEEE, d MMMM")}${activity ? `, ${activity} changes` : ""}`}
              aria-selected={selected}
              aria-current={date === today ? "date" : undefined}
              onClick={() => onSelectDate(date)}
              disabled={outsideAllowedRange}
              className={cn(
                "focus-visible:ring-primary relative grid aspect-square min-h-9 place-items-center rounded-xl text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
                !isSameMonth(day, month) && "text-muted-foreground/40",
                outsideAllowedRange &&
                  "text-muted-foreground/30 cursor-not-allowed hover:bg-transparent",
                date === today && "ring-primary text-primary ring-1",
                selected && "bg-primary text-primary-foreground ring-0",
                !selected && "hover:bg-secondary",
              )}
              data-testid={`calendar-day-${date}`}
            >
              {format(day, "d")}
              {activity > 0 ? (
                <span
                  className={cn(
                    "bg-primary absolute bottom-1 size-1 rounded-full",
                    selected && "bg-primary-foreground",
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        Dots show dates with attendance or timetable changes. Select a day to
        filter the list.
      </p>
    </Card>
  );
}

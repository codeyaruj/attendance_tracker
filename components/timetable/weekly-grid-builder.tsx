"use client";

import { AlertTriangle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { findDraftConflictSlotIds } from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { DAYS_OF_WEEK } from "@/types";
import type { DayOfWeek, DraftSlot, DraftSubject } from "@/types";

const visibleDays = DAYS_OF_WEEK;

export function WeeklyGridBuilder({
  slots,
  subjects,
  onAdd,
  onEdit,
}: {
  slots: DraftSlot[];
  subjects: DraftSubject[];
  onAdd: (day: DayOfWeek, startTime?: string) => void;
  onEdit: (slot: DraftSlot) => void;
}) {
  const timeRows = Array.from(
    new Set(slots.map((slot) => slot.startTime)),
  ).sort();
  const rows =
    timeRows.length > 0
      ? timeRows
      : ["09:00", "10:00", "11:00", "12:00", "14:00"];
  const conflictSlotIds = findDraftConflictSlotIds(slots);

  const subjectFor = (slot: DraftSlot) =>
    subjects.find((subject) => subject.temporaryId === slot.subjectTemporaryId);

  return (
    <div className="border-border bg-surface overflow-hidden rounded-2xl border">
      <div className="scrollbar-none overflow-x-auto">
        <div className="min-w-[1020px]">
          <div className="border-border bg-secondary/60 grid grid-cols-[88px_repeat(7,minmax(126px,1fr))] border-b">
            <div className="text-muted-foreground p-3 text-xs font-bold tracking-wider uppercase">
              Time
            </div>
            {visibleDays.map((day) => (
              <div
                key={day}
                className="border-border border-l p-3 text-center text-xs font-bold tracking-wider uppercase"
              >
                {day.slice(0, 3)}
              </div>
            ))}
          </div>
          {rows.map((time) => (
            <div
              key={time}
              className="border-border grid min-h-28 grid-cols-[88px_repeat(7,minmax(126px,1fr))] border-b last:border-b-0"
            >
              <div className="text-muted-foreground p-3 text-sm font-semibold">
                {time}
              </div>
              {visibleDays.map((day) => {
                const cellSlots = slots.filter(
                  (slot) => slot.dayOfWeek === day && slot.startTime === time,
                );
                return (
                  <div
                    key={day}
                    className="group border-border relative grid content-start gap-1.5 border-l p-1.5"
                  >
                    {cellSlots.map((slot) => {
                      const subject = subjectFor(slot);
                      const conflict = conflictSlotIds.has(slot.temporaryId);
                      return (
                        <button
                          key={slot.temporaryId}
                          type="button"
                          onClick={() => onEdit(slot)}
                          className={cn(
                            "border-primary/20 bg-primary-soft text-primary focus-visible:ring-primary min-h-16 rounded-xl border p-2 text-left transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none",
                            slot.isBreak &&
                              "border-border bg-secondary text-muted-foreground",
                            slot.isPlaceholder &&
                              "bg-warning-soft text-warning-strong border-dashed",
                          )}
                        >
                          <span className="flex items-start justify-between gap-1 text-xs font-extrabold">
                            {slot.isBreak
                              ? "Break"
                              : subject?.shortName ||
                                subject?.name ||
                                "Untitled"}
                            {conflict ? (
                              <AlertTriangle
                                className="size-3.5 shrink-0"
                                aria-label="Time conflict"
                              />
                            ) : null}
                          </span>
                          <span className="mt-1 block text-[10px] opacity-80">
                            {slot.startTime}–{slot.endTime}
                          </span>
                          {slot.batchOptions.length > 0 ? (
                            <Badge
                              tone="info"
                              className="mt-1 min-h-4 px-1.5 py-0 text-[9px]"
                            >
                              {slot.batchOptions.join(", ")}
                            </Badge>
                          ) : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onAdd(day, time)}
                      className="text-muted-foreground hover:border-border hover:bg-secondary focus-visible:ring-primary grid min-h-8 place-items-center rounded-lg border border-dashed border-transparent opacity-0 transition group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={`Add ${day.toLowerCase()} class at ${time}`}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="border-border bg-background/60 flex flex-wrap items-center justify-between gap-3 border-t p-3">
        <p className="text-muted-foreground text-xs">
          Scroll sideways on smaller screens. Overlapping alternatives show a
          warning.
        </p>
        <Button size="sm" variant="outline" onClick={() => onAdd("MONDAY")}>
          <Plus className="size-4" /> Add class
        </Button>
      </div>
    </div>
  );
}

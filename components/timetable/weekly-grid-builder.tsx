"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findDraftConflictSlotIds } from "@/lib/timetable";
import { DAYS_OF_WEEK } from "@/types";
import type { DayOfWeek, DraftSlot, DraftSubject } from "@/types";
import {
  WeeklyTimetableGrid,
  type WeeklyTimetableEntry,
} from "./weekly-timetable-grid";

const FALLBACK_TIME_SLOTS = [
  { startTime: "09:00", endTime: "10:00" },
  { startTime: "10:00", endTime: "11:00" },
  { startTime: "11:00", endTime: "12:00" },
  { startTime: "12:00", endTime: "13:00" },
  { startTime: "14:00", endTime: "15:00" },
];

export function WeeklyGridBuilder({
  slots,
  subjects,
  timeSlots,
  onAdd,
  onEdit,
}: {
  slots: DraftSlot[];
  subjects: DraftSubject[];
  timeSlots?: Array<{ startTime: string; endTime: string }>;
  onAdd: (day: DayOfWeek, startTime?: string) => void;
  onEdit: (slot: DraftSlot) => void;
}) {
  const conflictSlotIds = findDraftConflictSlotIds(slots);
  const slotsById = new Map(slots.map((slot) => [slot.temporaryId, slot]));
  const subjectsById = new Map(
    subjects.map((subject) => [subject.temporaryId, subject]),
  );
  const entries: WeeklyTimetableEntry[] = slots.map((slot) => {
    const subject = slot.subjectTemporaryId
      ? subjectsById.get(slot.subjectTemporaryId)
      : undefined;
    return {
      id: slot.temporaryId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      title: slot.isBreak
        ? "Break"
        : subject?.shortName || subject?.code || subject?.name || "Untitled",
      subjectName: subject?.name,
      faculty: slot.faculty,
      room: slot.room,
      qualifiers: [
        ...slot.batchOptions,
        ...(slot.electiveGroupId ? ["Elective"] : []),
        ...(slot.weekPattern !== "EVERY_WEEK"
          ? [slot.weekPattern.replaceAll("_", " ").toLowerCase()]
          : []),
      ],
      isBreak: slot.isBreak,
      isPlaceholder: slot.isPlaceholder,
      warning: conflictSlotIds.has(slot.temporaryId),
      lowConfidence: slot.confidence < 0.7,
    };
  });

  return (
    <div className="grid gap-3">
      <WeeklyTimetableGrid
        entries={entries}
        days={DAYS_OF_WEEK}
        timeSlots={
          timeSlots?.length || slots.length ? timeSlots : FALLBACK_TIME_SLOTS
        }
        onEmptySelect={onAdd}
        onSessionSelect={(entry) => {
          const slot = slotsById.get(entry.id);
          if (slot) onEdit(slot);
        }}
        describedBy="weekly-builder-hint"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-muted-foreground text-xs" id="weekly-builder-hint">
          Scroll sideways to see every time. Overlapping alternatives are
          stacked in the same weekday row.
        </p>
        <Button size="sm" variant="outline" onClick={() => onAdd("MONDAY")}>
          <Plus className="size-4" /> Add class
        </Button>
      </div>
    </div>
  );
}

"use client";

import {
  CalendarRange,
  ClipboardPaste,
  Copy,
  Grid3X3,
  List,
  Merge,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form-controls";
import {
  countExactDuplicateSlots,
  findDraftConflictSlotIds,
  mergeDuplicateSubjects,
  mergeExactDuplicateSlots,
  summarizeDuplicateSubjects,
  synchronizeDraftAlternatives,
  tryParsePastedTimetableText,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type DraftSlot,
  type DraftSubject,
  type NormalizedTimetableDraft,
} from "@/types";
import { SlotFormDialog } from "./slot-form-dialog";
import { WeeklyGridBuilder } from "./weekly-grid-builder";

function mergeSubject(
  subjects: DraftSubject[],
  subject: DraftSubject,
): DraftSubject[] {
  const existingIndex = subjects.findIndex(
    (item) => item.temporaryId === subject.temporaryId,
  );
  if (existingIndex === -1) return [...subjects, subject];
  return subjects.map((item, index) =>
    index === existingIndex ? subject : item,
  );
}

export function DraftEditor({
  value,
  onChange,
  compact = false,
}: {
  value: NormalizedTimetableDraft;
  onChange: (value: NormalizedTimetableDraft) => void;
  compact?: boolean;
}) {
  const [view, setView] = useState<"GRID" | "LIST">("GRID");
  const [editingSlot, setEditingSlot] = useState<DraftSlot | undefined>();
  const [newSlotContext, setNewSlotContext] = useState<{
    day?: DayOfWeek;
    start?: string;
    bulk?: boolean;
  }>();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const duplicateSlotCount = useMemo(
    () => countExactDuplicateSlots(value.timetableSlots),
    [value.timetableSlots],
  );
  const duplicateSubjectSummary = useMemo(
    () => summarizeDuplicateSubjects(value.subjects),
    [value.subjects],
  );
  const conflictCount = useMemo(
    () => findDraftConflictSlotIds(value.timetableSlots).size,
    [value.timetableSlots],
  );

  const saveSlot = (
    subject: DraftSubject | undefined,
    slot: DraftSlot,
    additions: DraftSlot[],
  ) => {
    const exists = value.timetableSlots.some(
      (item) => item.temporaryId === slot.temporaryId,
    );
    const baseSlots = exists
      ? value.timetableSlots.map((item) =>
          item.temporaryId === slot.temporaryId ? slot : item,
        )
      : [...value.timetableSlots, slot];
    const slots = [...baseSlots, ...additions];
    const nextDraft = synchronizeDraftAlternatives(
      {
        ...value,
        subjects: subject
          ? mergeSubject(value.subjects, subject)
          : value.subjects,
        timetableSlots: slots,
        days: Array.from(
          new Set([...value.days, ...slots.map((item) => item.dayOfWeek)]),
        ),
        timeSlots: Array.from(
          new Map(
            [
              ...value.timeSlots,
              ...slots.map((item) => ({
                startTime: item.startTime,
                endTime: item.endTime,
              })),
            ].map((item) => [`${item.startTime}-${item.endTime}`, item]),
          ).values(),
        ).sort((a, b) => a.startTime.localeCompare(b.startTime)),
      },
      editingSlot?.electiveGroupId &&
        editingSlot.electiveGroupId !== slot.electiveGroupId
        ? [editingSlot.electiveGroupId]
        : [],
    );
    onChange(nextDraft);
    if (additions.length > 0) {
      toast.success(`${additions.length + 1} class periods added`);
    }
  };

  const removeSlot = (slot: DraftSlot) => {
    onChange(
      synchronizeDraftAlternatives(
        {
          ...value,
          timetableSlots: value.timetableSlots.filter(
            (item) => item.temporaryId !== slot.temporaryId,
          ),
        },
        slot.electiveGroupId ? [slot.electiveGroupId] : [],
      ),
    );
    toast.success("Class removed");
  };

  const duplicateSlot = (slot: DraftSlot) => {
    onChange({
      ...value,
      timetableSlots: [
        ...value.timetableSlots,
        {
          ...slot,
          temporaryId: crypto.randomUUID(),
          notes: slot.notes ? `${slot.notes} (copy)` : "Copy",
        },
      ],
    });
    toast.success("Class duplicated — edit its day or time next");
  };

  const copyMonday = (day: DayOfWeek) => {
    const monday = value.timetableSlots.filter(
      (slot) => slot.dayOfWeek === "MONDAY",
    );
    onChange({
      ...value,
      timetableSlots: [
        ...value.timetableSlots.filter((slot) => slot.dayOfWeek !== day),
        ...monday.map((slot) => ({
          ...slot,
          temporaryId: crypto.randomUUID(),
          dayOfWeek: day,
        })),
      ],
      days: Array.from(new Set([...value.days, day])),
    });
    toast.success(`Monday copied to ${day.toLowerCase()}`);
  };

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="bg-secondary flex items-center rounded-xl p-1"
          aria-label="Builder view"
        >
          <Button
            size="sm"
            variant={view === "GRID" ? "primary" : "ghost"}
            onClick={() => setView("GRID")}
            aria-pressed={view === "GRID"}
          >
            <Grid3X3 className="size-4" /> Weekly grid
          </Button>
          <Button
            size="sm"
            variant={view === "LIST" ? "primary" : "ghost"}
            onClick={() => setView("LIST")}
            aria-pressed={view === "LIST"}
          >
            <List className="size-4" /> Form list
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPasteOpen(true)}
          >
            <ClipboardPaste className="size-4" /> Paste timetable
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingSlot(undefined);
              setNewSlotContext({ bulk: true });
            }}
          >
            <Rows3 className="size-4" /> Bulk-add subject
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingSlot(undefined);
              setNewSlotContext({});
            }}
            data-testid="add-class"
          >
            <Plus className="size-4" /> Add class
          </Button>
        </div>
      </div>

      {duplicateSubjectSummary.duplicateCount > 0 || duplicateSlotCount > 0 ? (
        <div className="border-warning-strong/20 bg-warning-soft text-warning-strong flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center">
          <p className="mr-auto">
            {duplicateSubjectSummary.duplicateCount > 0
              ? `${duplicateSubjectSummary.duplicateCount} duplicate subject ${duplicateSubjectSummary.duplicateCount === 1 ? "entry" : "entries"}`
              : null}
            {duplicateSubjectSummary.duplicateCount > 0 &&
            duplicateSlotCount > 0
              ? " and "
              : null}
            {duplicateSlotCount > 0
              ? `${duplicateSlotCount} exact duplicate ${duplicateSlotCount === 1 ? "class" : "classes"}`
              : null}{" "}
            found.
          </p>
          {duplicateSubjectSummary.duplicateCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const result = mergeDuplicateSubjects(value);
                onChange(result.draft);
                toast.success(
                  `${result.mergedCount} duplicate subject ${result.mergedCount === 1 ? "entry" : "entries"} merged`,
                );
              }}
            >
              <Merge className="size-4" /> Merge subjects
            </Button>
          ) : null}
          {duplicateSlotCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const result = mergeExactDuplicateSlots(value);
                onChange(result.draft);
                toast.success(
                  `${result.mergedCount} exact duplicate ${result.mergedCount === 1 ? "class" : "classes"} merged`,
                );
              }}
            >
              <Merge className="size-4" /> Merge exact classes
            </Button>
          ) : null}
        </div>
      ) : null}

      {conflictCount > 0 ? (
        <div className="border-danger/20 bg-danger-soft text-danger rounded-xl border px-4 py-3 text-sm font-semibold">
          {conflictCount} overlapping{" "}
          {conflictCount === 1 ? "class needs" : "classes need"} review.
          Mutually exclusive batch, elective, and odd/even alternatives are
          allowed.
        </div>
      ) : null}

      {view === "GRID" ? (
        <WeeklyGridBuilder
          slots={value.timetableSlots}
          subjects={value.subjects}
          onAdd={(day, start) => {
            setEditingSlot(undefined);
            setNewSlotContext({ day, start });
          }}
          onEdit={(slot) => {
            setNewSlotContext(undefined);
            setEditingSlot(slot);
          }}
        />
      ) : (
        <div className="grid gap-3">
          {value.timetableSlots.length === 0 ? (
            <Card className="border-dashed p-8 text-center">
              <CalendarRange className="text-primary mx-auto size-8" />
              <h3 className="mt-3 font-bold">Your timetable is empty</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Add subjects one class at a time or paste a text schedule.
              </p>
            </Card>
          ) : (
            value.timetableSlots
              .slice()
              .sort((a, b) =>
                `${a.dayOfWeek}${a.startTime}`.localeCompare(
                  `${b.dayOfWeek}${b.startTime}`,
                ),
              )
              .map((slot) => {
                const subject = value.subjects.find(
                  (item) => item.temporaryId === slot.subjectTemporaryId,
                );
                return (
                  <Card
                    key={slot.temporaryId}
                    className={cn(
                      "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
                      !slot.isEnabled && "opacity-55",
                    )}
                  >
                    <span className="bg-primary-soft text-primary grid size-11 shrink-0 place-items-center rounded-xl text-sm font-black">
                      {slot.isBreak
                        ? "—"
                        : subject?.shortName.slice(0, 3) || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-bold">
                          {slot.isBreak
                            ? "Break"
                            : (subject?.name ?? "Missing subject")}
                        </h3>
                        <Badge>{slot.classType.toLowerCase()}</Badge>
                        {slot.isPlaceholder ? (
                          <Badge tone="caution">placeholder</Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {slot.dayOfWeek[0] +
                          slot.dayOfWeek.slice(1).toLowerCase()}{" "}
                        · {slot.startTime}–{slot.endTime}
                        {slot.room ? ` · ${slot.room}` : ""}
                        {slot.faculty.length
                          ? ` · ${slot.faculty.join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex gap-1 self-end sm:self-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => duplicateSlot(slot)}
                        aria-label="Duplicate class"
                      >
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingSlot(slot)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSlot(slot)}
                        aria-label="Delete class"
                      >
                        <Trash2 className="text-danger size-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })
          )}
        </div>
      )}

      {!compact &&
      value.timetableSlots.some((slot) => slot.dayOfWeek === "MONDAY") ? (
        <div className="border-border bg-surface flex flex-wrap items-center gap-2 rounded-2xl border p-3">
          <span className="text-muted-foreground mr-auto text-sm font-semibold">
            Copy Monday’s complete schedule
          </span>
          {DAYS_OF_WEEK.filter((day) => day !== "MONDAY").map((day) => (
            <Button
              key={day}
              size="sm"
              variant="ghost"
              onClick={() => copyMonday(day)}
            >
              {day.slice(0, 3)}
            </Button>
          ))}
        </div>
      ) : null}

      <SlotFormDialog
        open={Boolean(editingSlot || newSlotContext)}
        onClose={() => {
          setEditingSlot(undefined);
          setNewSlotContext(undefined);
        }}
        subjects={value.subjects}
        slot={editingSlot}
        initialDay={newSlotContext?.day}
        initialStart={newSlotContext?.start}
        bulk={newSlotContext?.bulk}
        onSave={saveSlot}
      />

      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste timetable text"
        description="Use one class per line, for example: Monday 09:00-10:00 Digital Signal Processing"
      >
        <div className="grid gap-4">
          <Textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={9}
            placeholder={
              "Monday 09:00-10:00 Digital Signal Processing\nTuesday 11:00-12:00 Control Systems"
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const result = tryParsePastedTimetableText(pasteText, {
                  title: value.title,
                  timezone: value.timezone,
                });
                if (!result.success) {
                  toast.error(result.error.message);
                  return;
                }
                const parsed = result.data;
                onChange(
                  synchronizeDraftAlternatives({
                    ...value,
                    subjects: [...value.subjects, ...parsed.subjects],
                    timetableSlots: [
                      ...value.timetableSlots,
                      ...parsed.timetableSlots,
                    ],
                    days: Array.from(new Set([...value.days, ...parsed.days])),
                    timeSlots: Array.from(
                      new Map(
                        [...value.timeSlots, ...parsed.timeSlots].map(
                          (item) => [`${item.startTime}-${item.endTime}`, item],
                        ),
                      ).values(),
                    ).sort((a, b) => a.startTime.localeCompare(b.startTime)),
                    detectedBatchOptions: Array.from(
                      new Set([
                        ...value.detectedBatchOptions,
                        ...parsed.detectedBatchOptions,
                      ]),
                    ),
                    detectedElectiveGroups: [
                      ...value.detectedElectiveGroups,
                      ...parsed.detectedElectiveGroups.filter(
                        (group) =>
                          !value.detectedElectiveGroups.some(
                            (entry) => entry.id === group.id,
                          ),
                      ),
                    ],
                    ambiguousItems: [
                      ...value.ambiguousItems,
                      ...parsed.ambiguousItems,
                    ],
                    warnings: [...value.warnings, ...parsed.warnings],
                  }),
                );
                setPasteOpen(false);
                setPasteText("");
                toast.success(
                  `${parsed.timetableSlots.length} classes parsed — please review them`,
                );
              }}
            >
              Parse & review
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

"use client";

import {
  CalendarRange,
  ClipboardPaste,
  Copy,
  Grid3X3,
  List,
  Merge,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form-controls";
import {
  applyDraftSlotEdit,
  countExactDuplicateSlots,
  findDraftConflictSlotIds,
  mergeDuplicateSubjects,
  mergeExactDuplicateSlots,
  summarizeDuplicateSubjects,
  synchronizeDraftAlternatives,
  tryParsePastedTimetableText,
  type DraftSlotEditScope,
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
import { AddSubjectDialog } from "./add-subject-dialog";
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
  initialEditSlotId,
  fixedView,
  simple = false,
}: {
  value: NormalizedTimetableDraft;
  onChange: (value: NormalizedTimetableDraft) => void;
  compact?: boolean;
  initialEditSlotId?: string;
  fixedView?: "GRID" | "LIST";
  simple?: boolean;
}) {
  const [view, setView] = useState<"GRID" | "LIST">("LIST");
  const [pendingDelete, setPendingDelete] = useState<DraftSlot>();
  const [editingSlot, setEditingSlot] = useState<DraftSlot | undefined>(() =>
    initialEditSlotId
      ? value.timetableSlots.find(
          (slot) => slot.temporaryId === initialEditSlotId,
        )
      : undefined,
  );
  const [slotFormOpen, setSlotFormOpen] = useState(Boolean(initialEditSlotId));
  const [newSlotContext, setNewSlotContext] = useState<{
    day?: DayOfWeek;
    start?: string;
  }>();
  const [addSubjectOpen, setAddSubjectOpen] = useState(false);
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

  useEffect(() => {
    if (fixedView) return;
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem("attendsafe-editor-view");
      if (stored === "GRID" || stored === "LIST") setView(stored);
      else if (window.matchMedia("(min-width: 1024px)").matches)
        setView("GRID");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fixedView]);

  const activeView = fixedView ?? view;

  const changeView = (next: "GRID" | "LIST") => {
    setView(next);
    localStorage.setItem("attendsafe-editor-view", next);
  };

  const saveSlot = (
    subject: DraftSubject | undefined,
    slot: DraftSlot,
    editScope: DraftSlotEditScope,
  ) => {
    const exists = value.timetableSlots.some(
      (item) => item.temporaryId === slot.temporaryId,
    );
    const original = editingSlot;
    const applied = original
      ? applyDraftSlotEdit(value.timetableSlots, original, slot, editScope)
      : undefined;
    const baseSlots = exists
      ? (applied?.slots ?? value.timetableSlots)
      : [...value.timetableSlots, slot];
    const slots = baseSlots;
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
    if (editScope !== "ONE_SESSION") {
      const changed = applied?.changedCount ?? 1;
      toast.success(`${changed} recurring sessions updated`);
    }
  };

  const addSubject = (subject: DraftSubject, slots: DraftSlot[]) => {
    const nextSlots = [...value.timetableSlots, ...slots];
    onChange(
      synchronizeDraftAlternatives({
        ...value,
        subjects: mergeSubject(value.subjects, subject),
        timetableSlots: nextSlots,
        days: Array.from(
          new Set([...value.days, ...slots.map((slot) => slot.dayOfWeek)]),
        ),
        timeSlots: Array.from(
          new Map(
            [...value.timeSlots, ...slots].map((slot) => [
              `${slot.startTime}-${slot.endTime}`,
              { startTime: slot.startTime, endTime: slot.endTime },
            ]),
          ).values(),
        ).sort((left, right) => left.startTime.localeCompare(right.startTime)),
      }),
    );
    toast.success(
      `${subject.name} added with ${slots.length} recurring ${slots.length === 1 ? "session" : "sessions"}`,
    );
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
        {!fixedView ? (
          <div
            className="bg-secondary flex items-center rounded-xl p-1"
            aria-label="Builder view"
          >
            <Button
              size="sm"
              variant={view === "GRID" ? "primary" : "ghost"}
              onClick={() => changeView("GRID")}
              aria-pressed={view === "GRID"}
            >
              <Grid3X3 className="size-4" /> Weekly grid
            </Button>
            <Button
              size="sm"
              variant={view === "LIST" ? "primary" : "ghost"}
              onClick={() => changeView("LIST")}
              aria-pressed={view === "LIST"}
            >
              <List className="size-4" /> Form list
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm font-semibold">
            Tap any class to edit or remove it.
          </p>
        )}
        <div className="flex min-w-0 flex-wrap gap-2">
          {!simple ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPasteOpen(true)}
            >
              <ClipboardPaste className="size-4" /> Paste timetable
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => {
              setEditingSlot(undefined);
              setNewSlotContext(undefined);
              if (simple) setSlotFormOpen(true);
              else setAddSubjectOpen(true);
            }}
            data-testid="add-class"
          >
            <Plus className="size-4" /> {simple ? "Add class" : "Add Subject"}
          </Button>
        </div>
      </div>

      {!simple &&
      (duplicateSubjectSummary.duplicateCount > 0 || duplicateSlotCount > 0) ? (
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
          {simple
            ? "Some classes happen at the same time. Tap them to check which ones belong."
            : `${conflictCount} overlapping ${conflictCount === 1 ? "class needs" : "classes need"} review. Mutually exclusive group and odd/even alternatives are allowed.`}
        </div>
      ) : null}

      {activeView === "GRID" ? (
        <WeeklyGridBuilder
          slots={value.timetableSlots}
          subjects={value.subjects}
          timeSlots={value.timeSlots}
          onAdd={(day, start) => {
            setEditingSlot(undefined);
            setNewSlotContext({ day, start });
            if (simple) setSlotFormOpen(true);
            else setAddSubjectOpen(true);
          }}
          onEdit={(slot) => {
            setNewSlotContext(undefined);
            setEditingSlot(slot);
            setSlotFormOpen(true);
          }}
        />
      ) : (
        <div className="grid gap-3">
          {value.timetableSlots.length === 0 ? (
            <Card className="border-dashed p-8 text-center">
              <CalendarRange className="text-primary mx-auto size-8" />
              <h3 className="mt-3 font-bold">Your timetable is empty</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Add a subject with independent day timings, or paste a text
                schedule.
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
                        onClick={() => {
                          setEditingSlot(slot);
                          setSlotFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingDelete(slot)}
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
        open={slotFormOpen}
        onClose={() => {
          setSlotFormOpen(false);
          setEditingSlot(undefined);
          setNewSlotContext(undefined);
        }}
        subjects={value.subjects}
        slot={editingSlot}
        initialDay={newSlotContext?.day}
        initialStart={newSlotContext?.start}
        onSave={saveSlot}
        simple={simple}
        onDelete={
          editingSlot
            ? () => {
                setPendingDelete(editingSlot);
                setSlotFormOpen(false);
                setEditingSlot(undefined);
              }
            : undefined
        }
      />

      <AddSubjectDialog
        open={addSubjectOpen}
        subjects={value.subjects}
        existingSlots={value.timetableSlots}
        initialDay={newSlotContext?.day}
        initialStart={newSlotContext?.start}
        onClose={() => {
          setAddSubjectOpen(false);
          setNewSlotContext(undefined);
        }}
        onSave={addSubject}
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

      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(undefined)}
        title="Delete this class?"
        description="This removes the class from the timetable draft. Other classes and saved attendance are unchanged."
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setPendingDelete(undefined)}>
            Keep class
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingDelete) removeSlot(pendingDelete);
              setPendingDelete(undefined);
            }}
          >
            Delete class
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

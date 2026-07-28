"use client";

import { ArrowLeft, ArrowRight, Check, ImageIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatClockTime } from "@/components/attendance/attendance-view-model";
import { DraftEditor } from "@/components/timetable/draft-editor";
import { WeeklyTimetableGrid } from "@/components/timetable/weekly-timetable-grid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import {
  createPersonalTimetableDraft,
  normalizeGroupName,
  normalizeSelectedGroups,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import type {
  ClassType,
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types";
import type { ImageEdits } from "./upload-timetable";

export type ConfirmationSelections = {
  selectedGroups?: string[];
  batchDecision: "NOT_ASKED" | "SELECTED" | "NONE" | "UNSURE";
  batch?: string;
  electiveSubjectIds: Record<string, string[]>;
  tracked: Record<ClassType | "ZERO_CREDIT", boolean>;
  initialAttendance: Record<string, { held: number; attended: number }>;
};

type SourceReference = {
  file: File;
  edits: ImageEdits;
  extractionMessage?: string;
};

function subjectFor(
  draft: NormalizedTimetableDraft,
  slot: DraftSlot,
): DraftSubject | undefined {
  return draft.subjects.find(
    (subject) => subject.temporaryId === slot.subjectTemporaryId,
  );
}

function isUncertain(
  draft: NormalizedTimetableDraft,
  slot: DraftSlot,
): boolean {
  const subject = subjectFor(draft, slot);
  return (
    slot.confidence < 0.75 ||
    (subject?.confidence ?? 1) < 0.75 ||
    Boolean(slot.electiveGroupId) ||
    slot.isPlaceholder ||
    !slot.subjectTemporaryId
  );
}

function classLabel(draft: NormalizedTimetableDraft, slot: DraftSlot): string {
  const subject = subjectFor(draft, slot);
  return subject?.name ?? (slot.isBreak ? "Break" : "Unassigned class");
}

function trackedSelections(draft: NormalizedTimetableDraft) {
  const tracked: Record<ClassType | "ZERO_CREDIT", boolean> = {
    THEORY: false,
    LAB: false,
    TUTORIAL: false,
    SEMINAR: false,
    PROJECT: false,
    OTHER: false,
    ZERO_CREDIT: false,
  };
  for (const subject of draft.subjects) {
    tracked[subject.classType] = true;
    if (subject.isZeroCredit) tracked.ZERO_CREDIT = true;
  }
  return tracked;
}

function mergeReviewIntoSelectionSource({
  source,
  baseSlotIds,
  edited,
}: {
  source: NormalizedTimetableDraft;
  baseSlotIds: ReadonlySet<string>;
  edited: NormalizedTimetableDraft;
}): NormalizedTimetableDraft {
  const subjects = new Map(
    source.subjects.map((subject) => [subject.temporaryId, subject]),
  );
  for (const subject of edited.subjects) {
    subjects.set(subject.temporaryId, subject);
  }
  return {
    ...source,
    subjects: [...subjects.values()],
    timetableSlots: [
      ...source.timetableSlots.filter(
        (slot) => !baseSlotIds.has(slot.temporaryId),
      ),
      ...edited.timetableSlots,
    ],
  };
}

function Progress({ review }: { review: boolean }) {
  const steps = ["Upload", "Your classes", "Review"];
  const activeIndex = review ? 2 : 1;
  return (
    <ol
      className="grid grid-cols-3 gap-2"
      aria-label="Timetable setup progress"
    >
      {steps.map((label, index) => (
        <li
          key={label}
          className={cn(
            "border-border bg-surface text-muted-foreground flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-bold sm:px-3",
            index === activeIndex &&
              "border-primary bg-primary-soft text-primary",
            index < activeIndex && "bg-safe-soft text-safe-strong",
          )}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-current/10">
            {index < activeIndex ? <Check className="size-3" /> : index + 1}
          </span>
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function CompactSchedulePreview({
  draft,
}: {
  draft: NormalizedTimetableDraft;
}) {
  const slots = draft.timetableSlots.filter(
    (slot) => !slot.isBreak && !slot.isPlaceholder,
  );
  const entries = slots.map((slot) => {
    const subject = subjectFor(draft, slot);
    return {
      id: slot.temporaryId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      title: subject?.shortName || subject?.code || subject?.name || "Class",
      subjectName: subject?.name,
      qualifiers: slot.batchOptions,
    };
  });

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 lg:hidden" aria-label="Selected schedule">
        {slots.map((slot) => (
          <div
            key={slot.temporaryId}
            className="border-border bg-surface flex items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {classLabel(draft, slot)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {slot.dayOfWeek[0] + slot.dayOfWeek.slice(1).toLowerCase()} ·{" "}
                {formatClockTime(slot.startTime)}–
                {formatClockTime(slot.endTime)}
              </p>
            </div>
            {slot.batchOptions.length ? (
              <span className="bg-primary-soft text-primary rounded-full px-2 py-1 text-[10px] font-bold">
                {slot.batchOptions.join(" / ")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="hidden lg:block">
        <WeeklyTimetableGrid
          entries={entries}
          days={draft.days}
          timeSlots={draft.timeSlots}
          ariaLabel="Selected schedule preview"
        />
      </div>
    </div>
  );
}

export function TimetableConfirmation({
  value,
  source,
  onChange,
  onBack,
  onConfirm,
  saving,
}: {
  value: NormalizedTimetableDraft;
  source?: SourceReference;
  onChange: (value: NormalizedTimetableDraft) => void;
  onBack: () => void;
  onConfirm: (
    value: NormalizedTimetableDraft,
    selections: ConfirmationSelections,
  ) => void;
  saving: boolean;
}) {
  const [review, setReview] = useState(false);
  const [selectionSource, setSelectionSource] = useState(value);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [customGroup, setCustomGroup] = useState("");
  const [showCustomGroup, setShowCustomGroup] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(value);
  const [reviewBaseSlotIds, setReviewBaseSlotIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(
    () =>
      new Set(
        value.timetableSlots
          .filter(
            (slot) =>
              !slot.isBreak &&
              !slot.isPlaceholder &&
              slot.batchOptions.length === 0,
          )
          .map((slot) => slot.temporaryId),
      ),
  );
  const [excludedSlotIds, setExcludedSlotIds] = useState<Set<string>>(
    () => new Set(),
  );
  const previewUrl = useMemo(
    () => (source ? URL.createObjectURL(source.file) : undefined),
    [source],
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const groupOptions = useMemo(
    () =>
      normalizeSelectedGroups([
        ...selectionSource.detectedBatchOptions,
        ...selectionSource.timetableSlots.flatMap((slot) => slot.batchOptions),
        ...selectedGroups,
      ]),
    [selectedGroups, selectionSource],
  );
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const option of groupOptions) {
      const family = /^([a-z]+)/i.exec(option)?.[1]?.toUpperCase();
      const label = family ? `${family} groups` : "Other groups";
      groups.set(label, [...(groups.get(label) ?? []), option]);
    }
    return [...groups.entries()];
  }, [groupOptions]);
  const uncertainSlots = selectionSource.timetableSlots.filter(
    (slot) => !slot.isBreak && isUncertain(selectionSource, slot),
  );
  const uncertainIds = new Set(uncertainSlots.map((slot) => slot.temporaryId));
  const commonSubjects = selectionSource.subjects.flatMap((subject) => {
    const slotIds = selectionSource.timetableSlots
      .filter(
        (slot) =>
          slot.subjectTemporaryId === subject.temporaryId &&
          !slot.isBreak &&
          slot.batchOptions.length === 0 &&
          !uncertainIds.has(slot.temporaryId),
      )
      .map((slot) => slot.temporaryId);
    return slotIds.length ? [{ subject, slotIds }] : [];
  });
  const previewDraft = useMemo(
    () =>
      createPersonalTimetableDraft({
        draft: selectionSource,
        selectedGroups,
        selectedSlotIds,
        excludedSlotIds,
      }),
    [excludedSlotIds, selectedGroups, selectedSlotIds, selectionSource],
  );
  const selectedClassCount = previewDraft.timetableSlots.filter(
    (slot) => !slot.isBreak && !slot.isPlaceholder,
  ).length;

  const toggleSlotIds = (slotIds: readonly string[], checked: boolean) => {
    setSelectedSlotIds((current) => {
      const next = new Set(current);
      for (const id of slotIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setExcludedSlotIds((current) => {
      const next = new Set(current);
      for (const id of slotIds) {
        if (checked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };
  const toggleGroup = (group: string) => {
    const normalized = normalizeGroupName(group);
    setSelectedGroups((current) =>
      current.some((item) => normalizeGroupName(item) === normalized)
        ? current.filter((item) => normalizeGroupName(item) !== normalized)
        : normalizeSelectedGroups([...current, group]),
    );
  };
  const enterReview = () => {
    const personalDraft = createPersonalTimetableDraft({
      draft: selectionSource,
      selectedGroups,
      selectedSlotIds,
      excludedSlotIds,
    });
    setReviewBaseSlotIds(
      new Set(personalDraft.timetableSlots.map((slot) => slot.temporaryId)),
    );
    setReviewDraft(personalDraft);
    onChange(personalDraft);
    setReview(true);
  };
  const backToSelection = () => {
    const merged = mergeReviewIntoSelectionSource({
      source: selectionSource,
      baseSlotIds: reviewBaseSlotIds,
      edited: reviewDraft,
    });
    setSelectionSource(merged);
    onChange(merged);
    setSelectedSlotIds((current) => {
      const next = new Set(current);
      for (const id of reviewBaseSlotIds) next.delete(id);
      for (const slot of reviewDraft.timetableSlots) {
        if (!slot.isBreak && slot.batchOptions.length === 0) {
          next.add(slot.temporaryId);
        }
      }
      return next;
    });
    setReview(false);
  };
  const confirm = () => {
    const groups = normalizeSelectedGroups(selectedGroups);
    const electiveSubjectIds = Object.fromEntries(
      reviewDraft.detectedElectiveGroups.map((group) => [
        group.id,
        group.options.map((option) => option.subjectTemporaryId),
      ]),
    );
    onConfirm(reviewDraft, {
      selectedGroups: groups,
      batchDecision:
        groupOptions.length === 0
          ? "NOT_ASKED"
          : groups.length
            ? "SELECTED"
            : "NONE",
      batch: groups[0],
      electiveSubjectIds,
      tracked: trackedSelections(reviewDraft),
      initialAttendance: {},
    });
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5">
      <Progress review={review} />

      {!review ? (
        <>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
                Your classes
              </p>
              <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Which classes belong to you?
              </h1>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Select your groups and remove anything that is not part of your
                schedule.
              </p>
              {source?.extractionMessage
                ?.toLocaleLowerCase()
                .includes("ai-assisted") ? (
                <p className="bg-info-soft text-info-strong mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold">
                  AI-assisted extraction. Check the classes below before
                  continuing.
                </p>
              ) : null}
            </div>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="grid content-start gap-5">
              {commonSubjects.length ? (
                <Card className="p-4 sm:p-5">
                  <h2 className="font-extrabold">Common classes</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    These apply to everyone and start selected.
                  </p>
                  <div className="mt-4 grid gap-2">
                    {commonSubjects.map(({ subject, slotIds }) => {
                      const checked = slotIds.every((id) =>
                        selectedSlotIds.has(id),
                      );
                      return (
                        <label
                          key={subject.temporaryId}
                          className={cn(
                            "border-border flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 font-semibold transition",
                            checked && "border-primary bg-primary-soft",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleSlotIds(slotIds, event.target.checked)
                            }
                            className="accent-primary size-5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {subject.name}
                            </span>
                            {subject.code ? (
                              <span className="text-muted-foreground block text-xs font-normal">
                                {subject.code}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              ) : null}

              {groupedOptions.length ? (
                <Card className="p-4 sm:p-5">
                  <h2 className="font-extrabold">
                    Choose your lab or tutorial groups
                  </h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    You can choose more than one group.
                  </p>
                  <div className="mt-4 grid gap-4">
                    {groupedOptions.map(([label, options]) => (
                      <fieldset key={label}>
                        <legend className="text-sm font-bold">{label}</legend>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {options.map((option) => {
                            const checked = selectedGroups.some(
                              (item) =>
                                normalizeGroupName(item) ===
                                normalizeGroupName(option),
                            );
                            return (
                              <label
                                key={option}
                                className={cn(
                                  "border-border flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-bold",
                                  checked &&
                                    "border-primary bg-primary-soft text-primary",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleGroup(option)}
                                  className="accent-primary size-5"
                                />
                                {option}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                  <div className="mt-4">
                    {!showCustomGroup ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCustomGroup(true)}
                      >
                        <Plus className="size-4" /> Add another group
                      </Button>
                    ) : (
                      <div className="border-border grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_auto]">
                        <Input
                          aria-label="Custom group"
                          value={customGroup}
                          onChange={(event) =>
                            setCustomGroup(event.target.value)
                          }
                          placeholder="For example, A3"
                        />
                        <Button
                          variant="outline"
                          disabled={!customGroup.trim()}
                          onClick={() => {
                            setSelectedGroups((current) =>
                              normalizeSelectedGroups([
                                ...current,
                                customGroup,
                              ]),
                            );
                            setCustomGroup("");
                            setShowCustomGroup(false);
                          }}
                        >
                          Add group
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ) : null}

              {uncertainSlots.length ? (
                <Card className="p-4 sm:p-5">
                  <h2 className="font-extrabold">Check these classes</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    We were not completely sure about these classes.
                  </p>
                  <div className="mt-4 grid gap-2">
                    {uncertainSlots.map((slot) => {
                      const checked = previewDraft.timetableSlots.some(
                        (entry) => entry.temporaryId === slot.temporaryId,
                      );
                      return (
                        <label
                          key={slot.temporaryId}
                          className={cn(
                            "border-border flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3",
                            checked && "border-primary bg-primary-soft",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleSlotIds(
                                [slot.temporaryId],
                                event.target.checked,
                              )
                            }
                            className="accent-primary size-5"
                          />
                          <span className="min-w-0 text-sm">
                            <span className="block truncate font-bold">
                              {classLabel(selectionSource, slot)}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {slot.dayOfWeek[0] +
                                slot.dayOfWeek.slice(1).toLowerCase()}
                              , {formatClockTime(slot.startTime)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              ) : null}

              {source?.extractionMessage ||
              selectionSource.warnings.length ||
              selectionSource.ambiguousItems.length ? (
                <details className="border-border bg-surface rounded-2xl border p-4">
                  <summary className="cursor-pointer text-sm font-bold">
                    Something looks wrong
                  </summary>
                  <div className="text-muted-foreground mt-3 grid gap-2 text-xs leading-5">
                    {source?.extractionMessage ? (
                      <p>{source.extractionMessage}</p>
                    ) : null}
                    {selectionSource.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                    {selectionSource.ambiguousItems.map((item) => (
                      <p key={item.id}>{item.sourceDescription}</p>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>

            <Card className="min-w-0 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold">Your schedule</h2>
                  <p
                    className="text-primary mt-1 text-sm font-bold"
                    aria-live="polite"
                  >
                    {selectedClassCount} classes selected
                  </p>
                </div>
              </div>
              <div className="mt-4">
                {selectedClassCount ? (
                  <CompactSchedulePreview draft={previewDraft} />
                ) : (
                  <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
                    Select at least one class to continue.
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="border-border bg-background/95 sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button
              size="lg"
              disabled={selectedClassCount === 0}
              onClick={enterReview}
            >
              Review schedule <ArrowRight className="size-5" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
              Review
            </p>
            <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Review your schedule
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Tap a class to edit it or remove anything that does not belong.
            </p>
          </div>

          {source && previewUrl ? (
            <details className="border-border bg-surface rounded-2xl border p-4">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                <ImageIcon className="text-primary size-4" /> Compare with your
                upload
              </summary>
              <div className="bg-secondary mt-4 grid max-h-[420px] place-items-center overflow-hidden rounded-xl p-3">
                {source.file.type === "application/pdf" ? (
                  <object
                    data={previewUrl}
                    type="application/pdf"
                    className="h-[380px] w-full rounded-lg bg-white"
                    aria-label="Original timetable PDF"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Original uploaded timetable"
                    className="max-h-[390px] max-w-full object-contain"
                    style={{
                      transform: `rotate(${source.edits.rotation}deg) scale(${Math.min(source.edits.zoom, 1.2)})`,
                      clipPath: `inset(${source.edits.crop.top}% ${source.edits.crop.right}% ${source.edits.crop.bottom}% ${source.edits.crop.left}%)`,
                    }}
                  />
                )}
              </div>
            </details>
          ) : null}

          <Card className="min-w-0 p-3 sm:p-5">
            <DraftEditor
              value={reviewDraft}
              onChange={(next) => {
                setReviewDraft(next);
                onChange(next);
              }}
              compact
              fixedView="GRID"
              simple
            />
          </Card>

          <div className="border-border bg-background/95 sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border">
            <Button variant="ghost" onClick={backToSelection} disabled={saving}>
              <ArrowLeft className="size-4" /> Back to class selection
            </Button>
            <Button
              size="lg"
              disabled={
                saving ||
                reviewDraft.timetableSlots.every(
                  (slot) => slot.isBreak || slot.isPlaceholder,
                )
              }
              onClick={confirm}
              data-testid="confirm-timetable"
            >
              {saving ? "Saving locally…" : "Start tracking attendance"}
              <Check className="size-5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { ArrowLeft, ArrowRight, Check, ImageIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatClockTime } from "@/components/attendance/attendance-view-model";
import { DraftEditor } from "@/components/timetable/draft-editor";
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
  DayOfWeek,
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types";
import { DAYS_OF_WEEK } from "@/types";
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
      className="grid max-w-full min-w-0 grid-cols-3 gap-2"
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
  selectedGroups,
  onViewFullSchedule,
}: {
  draft: NormalizedTimetableDraft;
  selectedGroups: readonly string[];
  onViewFullSchedule: () => void;
}) {
  const slots = draft.timetableSlots.filter(
    (slot) => !slot.isBreak && !slot.isPlaceholder,
  );
  const slotsByDay = new Map<DayOfWeek, DraftSlot[]>();
  for (const day of DAYS_OF_WEEK) {
    const daySlots = slots
      .filter((slot) => slot.dayOfWeek === day)
      .sort((left, right) =>
        `${left.startTime}-${left.endTime}`.localeCompare(
          `${right.startTime}-${right.endTime}`,
        ),
      );
    if (daySlots.length) slotsByDay.set(day, daySlots);
  }

  const titleCaseDay = (day: DayOfWeek) => day[0] + day.slice(1).toLowerCase();

  return (
    <section
      className="grid min-w-0 gap-4"
      aria-labelledby="compact-schedule-heading"
      data-testid="compact-schedule-summary"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="compact-schedule-heading" className="font-extrabold">
            Your schedule
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            A quick summary of the classes you selected.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onViewFullSchedule}>
          View full schedule
        </Button>
      </div>

      <dl className="grid min-w-0 gap-2 sm:grid-cols-3">
        <div className="bg-secondary min-w-0 rounded-xl px-3 py-2.5">
          <dt className="text-muted-foreground text-[11px] font-bold uppercase">
            Selected
          </dt>
          <dd className="mt-0.5 text-sm font-extrabold" aria-live="polite">
            {slots.length} {slots.length === 1 ? "class" : "classes"} selected
          </dd>
        </div>
        <div className="bg-secondary min-w-0 rounded-xl px-3 py-2.5">
          <dt className="text-muted-foreground text-[11px] font-bold uppercase">
            Groups
          </dt>
          <dd className="mt-0.5 truncate text-sm font-extrabold">
            {selectedGroups.length ? selectedGroups.join(", ") : "No groups"}
          </dd>
        </div>
        <div className="bg-secondary min-w-0 rounded-xl px-3 py-2.5">
          <dt className="text-muted-foreground text-[11px] font-bold uppercase">
            Active days
          </dt>
          <dd className="mt-0.5 text-sm font-extrabold">{slotsByDay.size}</dd>
        </div>
      </dl>

      <div className="grid min-w-0 gap-3" aria-label="Selected schedule by day">
        {[...slotsByDay].map(([day, daySlots]) => (
          <section
            key={day}
            className="border-border min-w-0 rounded-xl border p-3"
          >
            <h3 className="text-sm font-extrabold">{titleCaseDay(day)}</h3>
            <ol className="mt-1.5 grid gap-1.5">
              {daySlots.slice(0, 3).map((slot) => (
                <li
                  key={slot.temporaryId}
                  className="flex min-w-0 items-baseline gap-2 text-xs"
                >
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {formatClockTime(slot.startTime)}
                  </span>
                  <span className="truncate font-semibold">
                    {classLabel(draft, slot)}
                  </span>
                </li>
              ))}
            </ol>
            {daySlots.length > 3 ? (
              <p className="text-primary mt-2 text-xs font-bold">
                +{daySlots.length - 3} more
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </section>
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
    <div
      className="mx-auto grid w-full max-w-7xl min-w-0 gap-5"
      data-pwa-critical-operation="true"
    >
      <Progress review={review} />

      {!review ? (
        <>
          <div className="min-w-0">
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

          <div className="grid min-w-0 gap-5 pb-[calc(7rem+env(safe-area-inset-bottom))] xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <div
              className="grid min-w-0 content-start gap-5"
              data-testid="class-selection-list"
            >
              {commonSubjects.length ? (
                <Card className="min-w-0 p-4 sm:p-5">
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
                          data-testid="class-selection-item"
                          className={cn(
                            "border-border flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 font-semibold transition",
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
                <Card className="min-w-0 p-4 sm:p-5">
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
                                  "border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold",
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
                <Card className="min-w-0 p-4 sm:p-5">
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
                          data-testid="class-selection-item"
                          className={cn(
                            "border-border flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2",
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

            <Card className="min-w-0 self-start p-4 sm:p-5">
              {selectedClassCount ? (
                <CompactSchedulePreview
                  draft={previewDraft}
                  selectedGroups={selectedGroups}
                  onViewFullSchedule={enterReview}
                />
              ) : (
                <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
                  Select at least one class to continue.
                </div>
              )}
            </Card>
          </div>

          <div
            className="border-border bg-background/95 sticky bottom-0 z-20 flex w-full min-w-0 flex-col-reverse gap-2 rounded-2xl border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:items-center sm:justify-between"
            data-testid="timetable-confirmation-actions"
          >
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
          <div className="min-w-0">
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

          <Card className="mb-[calc(7rem+env(safe-area-inset-bottom))] min-w-0 overflow-hidden p-3 sm:p-5">
            <div className="max-w-full min-w-0 overflow-hidden">
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
            </div>
          </Card>

          <div
            className="border-border bg-background/95 sticky bottom-0 z-20 flex w-full min-w-0 flex-col-reverse gap-2 rounded-2xl border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:items-center sm:justify-between"
            data-testid="timetable-confirmation-actions"
          >
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

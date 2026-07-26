"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ImageIcon,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Switch } from "@/components/ui/form-controls";
import { DraftEditor } from "@/components/timetable/draft-editor";
import { cn } from "@/lib/utils";
import type { ClassType, NormalizedTimetableDraft } from "@/types";
import type { ImageEdits } from "./upload-timetable";

export type ConfirmationSelections = {
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
type ConfirmationStep =
  "UNCERTAIN" | "BATCH" | "ELECTIVES" | "TYPES" | "REVIEW";
type ElectiveDecision = "SELECTED" | "NONE" | "UNSURE";

const stepLabels: Record<ConfirmationStep, string> = {
  UNCERTAIN: "Uncertain items",
  BATCH: "Your batch",
  ELECTIVES: "Electives",
  TYPES: "Class types",
  REVIEW: "Final review",
};

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

  const lowConfidenceCount =
    value.ambiguousItems.filter(
      (item) => item.confidence < 0.75 && !item.resolvedValue,
    ).length +
    value.subjects.filter((item) => item.confidence < 0.75).length +
    value.timetableSlots.filter((item) => item.confidence < 0.75).length;
  const steps = useMemo<ConfirmationStep[]>(
    () => [
      "UNCERTAIN",
      ...(value.detectedBatchOptions.length ? (["BATCH"] as const) : []),
      ...(value.detectedElectiveGroups.length ? (["ELECTIVES"] as const) : []),
      "TYPES",
      "REVIEW",
    ],
    [value.detectedBatchOptions.length, value.detectedElectiveGroups.length],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [batch, setBatch] = useState("");
  const [customBatch, setCustomBatch] = useState("");
  const [electives, setElectives] = useState<Record<string, string[]>>({});
  const [electiveDecisions, setElectiveDecisions] = useState<
    Record<string, ElectiveDecision>
  >({});
  const [customElectives, setCustomElectives] = useState<
    Record<string, string>
  >({});
  const [tracked, setTracked] = useState<
    Record<ClassType | "ZERO_CREDIT", boolean>
  >({
    THEORY: true,
    LAB: false,
    TUTORIAL: false,
    SEMINAR: false,
    PROJECT: false,
    OTHER: false,
    ZERO_CREDIT: false,
  });
  const [initialAttendance, setInitialAttendance] = useState<
    Record<string, { held: number; attended: number }>
  >({});
  const step = steps[stepIndex];

  const finalBatch =
    batch === "CUSTOM"
      ? customBatch.trim()
      : batch.startsWith("_")
        ? undefined
        : batch;
  const batchDecision: ConfirmationSelections["batchDecision"] =
    value.detectedBatchOptions.length === 0
      ? "NOT_ASKED"
      : batch === "_NONE"
        ? "NONE"
        : batch === "_UNSURE"
          ? "UNSURE"
          : "SELECTED";
  const batchInvalid = !batch || (batch === "CUSTOM" && !customBatch.trim());
  const electiveInvalid = value.detectedElectiveGroups.some((group) => {
    const decision = electiveDecisions[group.id];
    return (
      !decision ||
      (decision === "SELECTED" && (electives[group.id] ?? []).length === 0)
    );
  });
  const attendanceInvalid = Object.values(initialAttendance).some(
    (entry) =>
      !Number.isFinite(entry.held) ||
      !Number.isFinite(entry.attended) ||
      !Number.isInteger(entry.held) ||
      !Number.isInteger(entry.attended) ||
      entry.held < 0 ||
      entry.attended < 0 ||
      entry.attended > entry.held,
  );
  const uncertainInvalid =
    value.ambiguousItems.some(
      (item) => item.confidence < 0.75 && !item.resolvedValue?.trim(),
    ) ||
    value.subjects.some((item) => item.confidence < 0.75) ||
    value.timetableSlots.some((item) => item.confidence < 0.75);

  const addCustomElective = (groupId: string) => {
    const name = customElectives[groupId]?.trim();
    if (!name) return;
    const temporaryId = crypto.randomUUID();
    const shortName = name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 5)
      .toUpperCase();
    onChange({
      ...value,
      subjects: [
        ...value.subjects,
        {
          temporaryId,
          name,
          shortName: shortName || name.slice(0, 5).toUpperCase(),
          credits: 3,
          classType: "THEORY",
          faculty: [],
          isZeroCredit: false,
          confidence: 1,
        },
      ],
      detectedElectiveGroups: value.detectedElectiveGroups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              options: [
                ...group.options,
                { subjectTemporaryId: temporaryId, label: name },
              ],
            }
          : group,
      ),
    });
    setElectives((current) => ({
      ...current,
      [groupId]: value.detectedElectiveGroups.find(
        (group) => group.id === groupId,
      )?.allowMultiple
        ? [...(current[groupId] ?? []), temporaryId]
        : [temporaryId],
    }));
    setElectiveDecisions((current) => ({ ...current, [groupId]: "SELECTED" }));
    setCustomElectives((current) => ({ ...current, [groupId]: "" }));
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
            Confirm timetable
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Make it yours before it goes live
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            Batch and elective questions appear only when they are present in
            this timetable.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          Back to builder
        </Button>
      </div>

      <ol
        className="scrollbar-none flex gap-2 overflow-x-auto pb-1"
        aria-label="Timetable confirmation progress"
      >
        {steps.map((item, index) => (
          <li
            key={item}
            className={cn(
              "flex min-w-max items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold",
              index === stepIndex
                ? "border-primary bg-primary-soft text-primary"
                : index < stepIndex
                  ? "border-safe-strong/20 bg-safe-soft text-safe-strong"
                  : "border-border bg-surface text-muted-foreground",
            )}
          >
            <span className="grid size-5 place-items-center rounded-full bg-current/10">
              {index < stepIndex ? <Check className="size-3" /> : index + 1}
            </span>
            {stepLabels[item]}
          </li>
        ))}
      </ol>

      <Card className="p-5 sm:p-7">
        {step === "UNCERTAIN" ? (
          <div className="grid gap-5">
            <div className="flex items-start gap-3">
              <span className="bg-warning-soft text-warning-strong grid size-10 place-items-center rounded-xl">
                <CircleAlert className="size-5" />
              </span>
              <div>
                <h2 className="text-xl font-extrabold">
                  Review uncertain details
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Items below 75% confidence are never silently accepted.
                </p>
              </div>
            </div>
            {source?.extractionMessage ? (
              <div className="bg-info-soft text-info-strong rounded-xl p-4 text-sm">
                {source.extractionMessage}
              </div>
            ) : null}
            {value.warnings.map((warning) => (
              <div
                key={warning}
                className="bg-warning-soft text-warning-strong rounded-xl p-4 text-sm"
              >
                {warning}
              </div>
            ))}
            {value.ambiguousItems.length ? (
              <div className="grid gap-3">
                {value.ambiguousItems.map((item) => (
                  <div
                    key={item.id}
                    className="border-border grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_220px] sm:items-end"
                  >
                    <div>
                      <p className="font-bold">{item.sourceDescription}</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {item.field} · {Math.round(item.confidence * 100)}%
                        confidence · Suggestions:{" "}
                        {item.possibleValues.join(" / ") || "none"}
                      </p>
                    </div>
                    <Field label="Correction or review note">
                      <Input
                        value={item.resolvedValue ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            ambiguousItems: value.ambiguousItems.map((entry) =>
                              entry.id === item.id
                                ? {
                                    ...entry,
                                    resolvedValue: event.target.value,
                                  }
                                : entry,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-border bg-background rounded-2xl border border-dashed p-8 text-center">
                <Sparkles className="text-primary mx-auto size-7" />
                <h3 className="mt-3 font-bold">No ambiguous fields detected</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  You can still edit every class in the final review.
                </p>
              </div>
            )}
            {value.subjects.some((subject) => subject.confidence < 0.75) ? (
              <div className="grid gap-2">
                <h3 className="font-extrabold">Low-confidence subjects</h3>
                {value.subjects
                  .filter((subject) => subject.confidence < 0.75)
                  .map((subject) => (
                    <div
                      key={subject.temporaryId}
                      className="border-border flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                    >
                      <div className="mr-auto">
                        <p className="font-bold">{subject.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {subject.code || "No code"} ·{" "}
                          {Math.round(subject.confidence * 100)}% confidence
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onChange({
                            ...value,
                            subjects: value.subjects.map((entry) =>
                              entry.temporaryId === subject.temporaryId
                                ? { ...entry, confidence: 1 }
                                : entry,
                            ),
                          })
                        }
                      >
                        I reviewed this subject
                      </Button>
                    </div>
                  ))}
              </div>
            ) : null}
            {value.timetableSlots.some((slot) => slot.confidence < 0.75) ? (
              <div className="grid gap-2">
                <h3 className="font-extrabold">Low-confidence classes</h3>
                {value.timetableSlots
                  .filter((slot) => slot.confidence < 0.75)
                  .map((slot) => {
                    const subject = value.subjects.find(
                      (entry) => entry.temporaryId === slot.subjectTemporaryId,
                    );
                    return (
                      <div
                        key={slot.temporaryId}
                        className="border-border flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                      >
                        <div className="mr-auto">
                          <p className="font-bold">
                            {subject?.name ??
                              (slot.isBreak ? "Break" : "Unassigned class")}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {slot.dayOfWeek} · {slot.startTime}–{slot.endTime} ·{" "}
                            {Math.round(slot.confidence * 100)}% confidence
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            onChange({
                              ...value,
                              timetableSlots: value.timetableSlots.map(
                                (entry) =>
                                  entry.temporaryId === slot.temporaryId
                                    ? { ...entry, confidence: 1 }
                                    : entry,
                              ),
                            })
                          }
                        >
                          I reviewed this class
                        </Button>
                      </div>
                    );
                  })}
              </div>
            ) : null}
            {lowConfidenceCount > 0 ? (
              <p className="text-warning-strong text-sm">
                {lowConfidenceCount} low-confidence{" "}
                {lowConfidenceCount === 1 ? "item remains" : "items remain"};
                confirm them in the final editor.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "BATCH" ? (
          <div className="mx-auto grid max-w-xl gap-5">
            <div>
              <h2 className="text-xl font-extrabold">
                Which batch applies to you?
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Only matching batch alternatives will be enabled.
              </p>
            </div>
            <div className="grid gap-2">
              {value.detectedBatchOptions.map((option) => (
                <label
                  key={option}
                  className="border-border flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 font-semibold"
                >
                  <input
                    type="radio"
                    name="batch"
                    value={option}
                    checked={batch === option}
                    onChange={() => setBatch(option)}
                    className="accent-primary size-4"
                  />
                  {option}
                </label>
              ))}
              <label className="border-border flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 font-semibold">
                <input
                  type="radio"
                  name="batch"
                  checked={batch === "_NONE"}
                  onChange={() => setBatch("_NONE")}
                  className="accent-primary size-4"
                />
                My timetable does not use batches
              </label>
              <label className="border-border flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 font-semibold">
                <input
                  type="radio"
                  name="batch"
                  checked={batch === "_UNSURE"}
                  onChange={() => setBatch("_UNSURE")}
                  className="accent-primary size-4"
                />
                I am not sure
              </label>
              <label className="border-border grid cursor-pointer gap-2 rounded-xl border p-3 font-semibold">
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="batch"
                    checked={batch === "CUSTOM"}
                    onChange={() => setBatch("CUSTOM")}
                    className="accent-primary size-4"
                  />
                  Enter another batch
                </span>
                {batch === "CUSTOM" ? (
                  <Input
                    autoFocus
                    value={customBatch}
                    onChange={(event) => setCustomBatch(event.target.value)}
                    placeholder="Batch name"
                  />
                ) : null}
              </label>
            </div>
          </div>
        ) : null}

        {step === "ELECTIVES" ? (
          <div className="grid gap-7">
            <div>
              <h2 className="text-xl font-extrabold">Choose your electives</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Alternatives stay preserved in the timetable history.
              </p>
            </div>
            {value.detectedElectiveGroups.map((group) => (
              <fieldset
                key={group.id}
                className="border-border grid gap-2 rounded-2xl border p-4"
              >
                <legend className="px-2 font-extrabold">{group.name}</legend>
                {group.options.map((option) => {
                  const checked = (electives[group.id] ?? []).includes(
                    option.subjectTemporaryId,
                  );
                  return (
                    <label
                      key={option.subjectTemporaryId}
                      className="bg-secondary flex min-h-11 cursor-pointer items-center gap-3 rounded-xl p-3 text-sm font-semibold"
                    >
                      <input
                        type={group.allowMultiple ? "checkbox" : "radio"}
                        name={group.id}
                        checked={checked}
                        onChange={() => {
                          const selected = group.allowMultiple
                            ? checked
                              ? (electives[group.id] ?? []).filter(
                                  (id) => id !== option.subjectTemporaryId,
                                )
                              : [
                                  ...(electives[group.id] ?? []),
                                  option.subjectTemporaryId,
                                ]
                            : [option.subjectTemporaryId];
                          setElectives((current) => ({
                            ...current,
                            [group.id]: selected,
                          }));
                          setElectiveDecisions((current) => ({
                            ...current,
                            [group.id]:
                              selected.length > 0
                                ? "SELECTED"
                                : current[group.id],
                          }));
                        }}
                        className="accent-primary size-4"
                      />
                      {option.label}
                    </label>
                  );
                })}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl p-3 text-sm font-semibold">
                  <input
                    type="radio"
                    name={group.id}
                    checked={electiveDecisions[group.id] === "NONE"}
                    onChange={() => {
                      setElectives((current) => ({
                        ...current,
                        [group.id]: [],
                      }));
                      setElectiveDecisions((current) => ({
                        ...current,
                        [group.id]: "NONE",
                      }));
                    }}
                    className="accent-primary size-4"
                  />
                  None
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl p-3 text-sm font-semibold">
                  <input
                    type="radio"
                    name={group.id}
                    checked={electiveDecisions[group.id] === "UNSURE"}
                    onChange={() => {
                      setElectives((current) => ({
                        ...current,
                        [group.id]: [],
                      }));
                      setElectiveDecisions((current) => ({
                        ...current,
                        [group.id]: "UNSURE",
                      }));
                    }}
                    className="accent-primary size-4"
                  />
                  I am not sure
                </label>
                <div className="border-border grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Field label="Enter another subject">
                    <Input
                      value={customElectives[group.id] ?? ""}
                      onChange={(event) =>
                        setCustomElectives((current) => ({
                          ...current,
                          [group.id]: event.target.value,
                        }))
                      }
                      placeholder="Subject name"
                    />
                  </Field>
                  <Button
                    variant="outline"
                    disabled={!customElectives[group.id]?.trim()}
                    onClick={() => addCustomElective(group.id)}
                  >
                    Add & select
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
        ) : null}

        {step === "TYPES" ? (
          <div className="grid gap-5">
            <div>
              <h2 className="text-xl font-extrabold">
                What should count toward attendance?
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Theory starts enabled. Labs, projects, and zero-credit subjects
                are opt-in.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  "THEORY",
                  "LAB",
                  "TUTORIAL",
                  "SEMINAR",
                  "PROJECT",
                  "ZERO_CREDIT",
                ] as const
              ).map((type) => (
                <Switch
                  key={type}
                  checked={tracked[type]}
                  onChange={(checked) =>
                    setTracked((current) => ({ ...current, [type]: checked }))
                  }
                  label={
                    type === "ZERO_CREDIT"
                      ? "Zero-credit subjects"
                      : `${type[0]}${type.slice(1).toLowerCase()}${type === "THEORY" ? " classes" : "s"}`
                  }
                  description={
                    type === "PROJECT"
                      ? "Static placeholders remain ignored"
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {step === "REVIEW" ? (
          <div className="grid gap-6">
            <div>
              <h2 className="text-xl font-extrabold">Final timetable review</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Add, move, duplicate, disable, or correct any class. It becomes
                active only when you confirm below.
              </p>
            </div>
            {source && previewUrl ? (
              <details
                className="border-border bg-background rounded-2xl border p-4"
                open
              >
                <summary className="flex cursor-pointer items-center gap-2 font-bold">
                  <ImageIcon className="text-primary size-4" /> Compare with
                  uploaded source
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
                    // The source is a private, in-memory object URL and cannot use Next's optimizer.
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
            <DraftEditor value={value} onChange={onChange} />

            <div className="border-border bg-background rounded-2xl border p-4 sm:p-5">
              <h3 className="font-extrabold">Joining mid-semester?</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                Enter counts—not a percentage. Leave both at zero for a new
                semester.
              </p>
              <div className="mt-4 grid gap-2">
                {value.subjects
                  .filter(
                    (subject) => !subject.isZeroCredit || tracked.ZERO_CREDIT,
                  )
                  .map((subject) => {
                    const entry = initialAttendance[subject.temporaryId] ?? {
                      held: 0,
                      attended: 0,
                    };
                    const heldInvalid =
                      !Number.isFinite(entry.held) ||
                      !Number.isInteger(entry.held) ||
                      entry.held < 0;
                    const attendedInvalid =
                      !Number.isFinite(entry.attended) ||
                      !Number.isInteger(entry.attended) ||
                      entry.attended < 0 ||
                      entry.attended > entry.held;
                    return (
                      <div
                        key={subject.temporaryId}
                        className="bg-surface grid gap-2 rounded-xl p-3 sm:grid-cols-[1fr_120px_120px] sm:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {subject.name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {subject.code || subject.shortName}
                          </p>
                        </div>
                        <Field
                          label="Classes held"
                          error={
                            heldInvalid
                              ? "Use a whole count of 0 or more"
                              : undefined
                          }
                        >
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={entry.held}
                            onChange={(event) =>
                              setInitialAttendance((current) => ({
                                ...current,
                                [subject.temporaryId]: {
                                  ...entry,
                                  held: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </Field>
                        <Field
                          label="Attended"
                          error={
                            attendedInvalid
                              ? entry.attended > entry.held
                                ? "Cannot exceed held"
                                : "Use a whole count of 0 or more"
                              : undefined
                          }
                        >
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            max={entry.held}
                            value={entry.attended}
                            onChange={(event) =>
                              setInitialAttendance((current) => ({
                                ...current,
                                [subject.temporaryId]: {
                                  ...entry,
                                  attended: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </Field>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="border-border bg-background/95 sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border sm:px-4">
        <Button
          variant="ghost"
          className="w-full sm:w-auto"
          disabled={stepIndex === 0 || saving}
          onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
        >
          <ArrowLeft className="size-4" /> Previous
        </Button>
        {step === "REVIEW" ? (
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={
              saving || attendanceInvalid || value.timetableSlots.length === 0
            }
            onClick={() =>
              onConfirm(value, {
                batchDecision,
                batch: finalBatch,
                electiveSubjectIds: electives,
                tracked,
                initialAttendance,
              })
            }
            data-testid="confirm-timetable"
          >
            {saving ? "Saving locally…" : "Confirm & open AttendSafe"}
            <Check className="size-5" />
          </Button>
        ) : (
          <Button
            className="w-full sm:w-auto"
            disabled={
              (step === "UNCERTAIN" && uncertainInvalid) ||
              (step === "BATCH" && batchInvalid) ||
              (step === "ELECTIVES" && electiveInvalid) ||
              saving
            }
            onClick={() =>
              setStepIndex((index) => Math.min(steps.length - 1, index + 1))
            }
          >
            Continue <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

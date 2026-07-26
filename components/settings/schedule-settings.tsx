"use client";

import { format, subDays } from "date-fns";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/form-controls";
import {
  attendSafeRepository,
  createEntityId,
  createRepositories,
  db,
  entityTimestamps,
  type AttendSafeSnapshot,
} from "@/db";
import type {
  AcademicException,
  ExceptionType,
  TimetableVersion,
} from "@/types/domain";

import { SettingsSection } from "./settings-section";

const closureTypes: Array<{ value: ExceptionType; label: string }> = [
  { value: "HOLIDAY", label: "Holiday" },
  { value: "BREAK", label: "Reading / exam break" },
  { value: "CANCELLED_DAY", label: "Cancelled teaching day" },
];

function exceptionLabel(type: ExceptionType): string {
  return (
    closureTypes.find((option) => option.value === type)?.label ??
    type.toLowerCase().replaceAll("_", " ")
  );
}

export function ScheduleSettings({ data }: { data: AttendSafeSnapshot }) {
  const semester = data.activeSemester;
  const [batch, setBatch] = useState(data.settings.selectedBatch ?? "");
  const [exceptionType, setExceptionType] = useState<ExceptionType>("HOLIDAY");
  const [exceptionStart, setExceptionStart] = useState(
    semester?.startDate ?? format(new Date(), "yyyy-MM-dd"),
  );
  const [exceptionEnd, setExceptionEnd] = useState(
    semester?.startDate ?? format(new Date(), "yyyy-MM-dd"),
  );
  const [exceptionNotes, setExceptionNotes] = useState("");
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const [removingException, setRemovingException] = useState<string>();
  const [versionLabel, setVersionLabel] = useState("Updated timetable");
  const [effectiveDate, setEffectiveDate] = useState(
    semester?.startDate ?? format(new Date(), "yyyy-MM-dd"),
  );
  const [versionBusy, setVersionBusy] = useState(false);

  const batchOptions = useMemo(
    () =>
      [
        ...new Set(
          data.timetableSlots.flatMap((slot) => slot.batchRestriction),
        ),
      ].sort(),
    [data.timetableSlots],
  );
  const versions = useMemo(
    () =>
      [...data.timetableVersions].sort((left, right) =>
        left.effectiveStartDate.localeCompare(right.effectiveStartDate),
      ),
    [data.timetableVersions],
  );

  if (!semester) return null;

  const saveBatch = async (value: string) => {
    setBatch(value);
    try {
      await attendSafeRepository.updateSettings({
        selectedBatch: value || undefined,
      });
      toast.success(
        value ? `Batch ${value} selected` : "Batch filtering disabled",
      );
    } catch (cause) {
      setBatch(data.settings.selectedBatch ?? "");
      toast.error(
        cause instanceof Error ? cause.message : "Batch could not be saved.",
      );
    }
  };

  const toggleElective = async (
    groupId: string,
    subjectId: string,
    checked: boolean,
  ) => {
    const group = data.electiveGroups.find((item) => item.id === groupId);
    if (!group) return;
    const selectedSubjectIds = group.allowMultiple
      ? checked
        ? [...new Set([...group.selectedSubjectIds, subjectId])]
        : group.selectedSubjectIds.filter((id) => id !== subjectId)
      : checked
        ? [subjectId]
        : [];
    try {
      await createRepositories(db).electiveGroups.update(group.id, {
        selectedSubjectIds,
      });
      toast.success(`${group.name} selection saved`);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Elective could not be saved.",
      );
    }
  };

  const setElectiveSelectionMode = async (
    groupId: string,
    allowMultiple: boolean,
  ) => {
    const group = data.electiveGroups.find((item) => item.id === groupId);
    if (!group) return;
    const selectedSubjectIds = allowMultiple
      ? group.selectedSubjectIds
      : group.selectedSubjectIds.slice(0, 1);
    try {
      await createRepositories(db).electiveGroups.update(group.id, {
        allowMultiple,
        selectedSubjectIds,
      });
      toast.success(
        `${group.name} now ${allowMultiple ? "allows multiple subjects" : "allows one subject"}`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Elective selection mode could not be saved.",
      );
    }
  };

  const addException = async (event: FormEvent) => {
    event.preventDefault();
    if (exceptionEnd < exceptionStart) {
      toast.error("The closure end date must be on or after its start date.");
      return;
    }
    if (
      exceptionStart < semester.startDate ||
      exceptionEnd > semester.endDate
    ) {
      toast.error(
        `Closure dates must stay inside the semester (${semester.startDate} to ${semester.endDate}).`,
      );
      return;
    }
    setExceptionBusy(true);
    try {
      await attendSafeRepository.saveException({
        id: createEntityId(),
        semesterId: semester.id,
        type: exceptionType,
        startDate: exceptionStart,
        endDate: exceptionEnd,
        notes: exceptionNotes.trim() || undefined,
        ...entityTimestamps(),
      });
      setExceptionNotes("");
      toast.success("Academic exception saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Exception could not be saved.",
      );
    } finally {
      setExceptionBusy(false);
    }
  };

  const deleteException = async (exception: AcademicException) => {
    try {
      await db.academicExceptions.delete(exception.id);
      setRemovingException(undefined);
      toast.success("Academic exception removed");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Exception could not be removed.",
      );
    }
  };

  const addVersion = async (event: FormEvent) => {
    event.preventDefault();
    const previous = versions.at(-1);
    if (!previous) {
      toast.error("Confirm a timetable before creating a new version.");
      return;
    }
    if (
      effectiveDate <= previous.effectiveStartDate ||
      effectiveDate < semester.startDate ||
      effectiveDate > semester.endDate
    ) {
      toast.error(
        "The new version must start after the current version and inside the semester.",
      );
      return;
    }
    const sourceSlots = data.timetableSlots.filter(
      (slot) => slot.timetableVersionId === previous.id,
    );
    const now = new Date().toISOString();
    const version: TimetableVersion = {
      id: createEntityId(),
      timetableId: previous.timetableId,
      semesterId: semester.id,
      version: Math.max(...versions.map((item) => item.version)) + 1,
      label: versionLabel.trim() || `Version ${versions.length + 1}`,
      effectiveStartDate: effectiveDate,
      effectiveEndDate: semester.endDate,
      isConfirmed: true,
      source: "MANUAL",
      ...entityTimestamps(now),
    };
    const previousEnd = format(
      subDays(new Date(`${effectiveDate}T12:00:00`), 1),
      "yyyy-MM-dd",
    );
    setVersionBusy(true);
    try {
      await db.transaction(
        "rw",
        [db.semesters, db.timetableVersions, db.timetableSlots],
        async () => {
          await db.timetableVersions.put({
            ...previous,
            effectiveEndDate: previousEnd,
            updatedAt: now,
          });
          await db.timetableVersions.add(version);
          if (sourceSlots.length > 0) {
            await db.timetableSlots.bulkAdd(
              sourceSlots.map((slot) => ({
                ...slot,
                id: createEntityId(),
                timetableVersionId: version.id,
                createdAt: now,
                updatedAt: now,
              })),
            );
          }
          await db.semesters.put({
            ...semester,
            activeTimetableVersionId: version.id,
            updatedAt: now,
          });
        },
      );
      toast.success("New timetable version created");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Version could not be created.",
      );
    } finally {
      setVersionBusy(false);
    }
  };

  return (
    <SettingsSection
      id="schedule-rules"
      icon={CalendarClock}
      title="Schedule rules"
      description="Resolve batch and elective alternatives, record closures, and preserve timetable changes as dated versions."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-bold">Batch and electives</h3>
          <div className="mt-4">
            <Field
              label="Selected batch"
              hint="Choose no batch when your timetable has no batch-specific alternatives."
            >
              <Select
                value={batch}
                onChange={(event) => void saveBatch(event.target.value)}
              >
                <option value="">My timetable does not use batches</option>
                {batchOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {batch && !batchOptions.includes(batch) ? (
                  <option value={batch}>{batch}</option>
                ) : null}
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid gap-3">
            {data.electiveGroups.map((group) => (
              <fieldset
                key={group.id}
                className="border-border rounded-2xl border p-4"
              >
                <legend className="px-1 text-sm font-bold">{group.name}</legend>
                <p className="text-muted-foreground mt-1 px-2 text-xs">
                  {group.allowMultiple
                    ? "Choose any that apply."
                    : "Choose one subject, or none."}
                </p>
                <div className="mt-3">
                  <Switch
                    checked={group.allowMultiple ?? false}
                    onChange={(checked) =>
                      void setElectiveSelectionMode(group.id, checked)
                    }
                    label={`Allow multiple subjects in ${group.name}`}
                    description="Use this when you attend more than one option from this group."
                  />
                </div>
                <div className="mt-1 grid gap-2">
                  {group.options.map((option) => (
                    <label
                      key={option.subjectId}
                      className="hover:bg-secondary flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm"
                    >
                      <input
                        type={group.allowMultiple ? "checkbox" : "radio"}
                        name={`elective-${group.id}`}
                        className="accent-primary size-4"
                        checked={group.selectedSubjectIds.includes(
                          option.subjectId,
                        )}
                        onChange={(event) =>
                          void toggleElective(
                            group.id,
                            option.subjectId,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  {!group.allowMultiple ? (
                    <label className="hover:bg-secondary flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm">
                      <input
                        type="radio"
                        name={`elective-${group.id}`}
                        className="accent-primary size-4"
                        checked={group.selectedSubjectIds.length === 0}
                        onChange={() => {
                          const selected = group.selectedSubjectIds[0];
                          if (selected)
                            void toggleElective(group.id, selected, false);
                        }}
                      />
                      <span>None</span>
                    </label>
                  ) : null}
                </div>
              </fieldset>
            ))}
            {data.electiveGroups.length === 0 ? (
              <p className="bg-secondary text-muted-foreground rounded-2xl p-4 text-sm">
                No elective alternatives were detected.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="font-bold">Holidays and closures</h3>
          <form
            className="bg-secondary mt-4 grid gap-3 rounded-2xl p-4"
            onSubmit={(event) => void addException(event)}
          >
            <Field label="Exception type">
              <Select
                value={exceptionType}
                onChange={(event) =>
                  setExceptionType(event.target.value as ExceptionType)
                }
              >
                {closureTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Starts"
                hint={`Semester starts ${semester.startDate}`}
              >
                <Input
                  type="date"
                  value={exceptionStart}
                  onChange={(event) => setExceptionStart(event.target.value)}
                  min={semester.startDate}
                  max={semester.endDate}
                  required
                />
              </Field>
              <Field label="Ends" hint={`Semester ends ${semester.endDate}`}>
                <Input
                  type="date"
                  value={exceptionEnd}
                  onChange={(event) => setExceptionEnd(event.target.value)}
                  min={semester.startDate}
                  max={semester.endDate}
                  required
                />
              </Field>
            </div>
            <Field label="Notes (optional)">
              <Textarea
                className="min-h-20"
                value={exceptionNotes}
                onChange={(event) => setExceptionNotes(event.target.value)}
              />
            </Field>
            <div className="text-right">
              <Button type="submit" size="sm" disabled={exceptionBusy}>
                <Plus className="size-4" aria-hidden="true" />
                {exceptionBusy ? "Saving…" : "Add exception"}
              </Button>
            </div>
          </form>
          <div className="mt-3 grid gap-2">
            {data.academicExceptions.map((exception) => (
              <div
                key={exception.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div>
                  <p className="text-sm font-bold">
                    {exceptionLabel(exception.type)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {exception.startDate}
                    {exception.endDate !== exception.startDate
                      ? ` to ${exception.endDate}`
                      : ""}
                    {exception.notes ? ` · ${exception.notes}` : ""}
                  </p>
                </div>
                {removingException === exception.id ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRemovingException(undefined)}
                    >
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void deleteException(exception)}
                    >
                      Confirm remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${exceptionLabel(exception.type)}`}
                    onClick={() => setRemovingException(exception.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border mt-7 border-t pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-bold">Timetable version history</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Attendance remains linked to the schedule version active on each
              date.
            </p>
          </div>
          <Badge tone="info">{versions.length} versions</Badge>
        </div>
        <ol className="mt-4 grid gap-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className="border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="text-sm font-bold">
                  v{version.version} · {version.label}
                </p>
                <p className="text-muted-foreground text-xs">
                  {version.effectiveStartDate} to{" "}
                  {version.effectiveEndDate ?? "ongoing"} ·{" "}
                  {version.source.toLowerCase()}
                </p>
              </div>
              {semester.activeTimetableVersionId === version.id ? (
                <Badge tone="safe">Active</Badge>
              ) : null}
            </li>
          ))}
        </ol>
        <form
          className="bg-secondary mt-4 grid gap-3 rounded-2xl p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          onSubmit={(event) => void addVersion(event)}
        >
          <Field label="New version label">
            <Input
              value={versionLabel}
              onChange={(event) => setVersionLabel(event.target.value)}
              required
            />
          </Field>
          <Field label="Effective from">
            <Input
              type="date"
              min={semester.startDate}
              max={semester.endDate}
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={versionBusy || versions.length === 0}>
            <Plus className="size-4" aria-hidden="true" />
            {versionBusy ? "Creating…" : "New version"}
          </Button>
        </form>
      </div>
    </SettingsSection>
  );
}

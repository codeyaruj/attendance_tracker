"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  RotateCcw,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  buildSubjectViews,
  displayPercentage,
  formatClockTime,
  isoDateInTimeZone,
  resolveSnapshotSessionsForDate,
  riskTone,
  toClassSession,
  viewForSubject,
} from "@/components/attendance/attendance-view-model";
import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import {
  attendSafeRepository,
  type AttendSafeSnapshot,
  type TimetableBundle,
} from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import {
  detectDuplicateSlots,
  detectSlotConflicts,
  filterTimetableSlots,
  resolveTimetableVersionForDate,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import {
  DAYS_OF_WEEK,
  type AttendanceStatus,
  type DayOfWeek,
  type DraftSlot,
  type DraftSubject,
  type NormalizedTimetableDraft,
  type Subject,
  type TimetableSlot,
  type TimetableVersion,
} from "@/types";

import { DraftEditor } from "./draft-editor";

const FALLBACK_DAYS = DAYS_OF_WEEK;

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function currentDay(timeZone?: string): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone,
  })
    .format(new Date())
    .toUpperCase() as DayOfWeek;
}

function currentTime(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date());
}

function activeVersionFor(
  snapshot: AttendSafeSnapshot,
  date: string,
): TimetableVersion | undefined {
  const pinned = snapshot.activeSemester?.activeTimetableVersionId;
  return (
    snapshot.timetableVersions.find((version) => version.id === pinned) ??
    resolveTimetableVersionForDate(snapshot.timetableVersions, date) ??
    snapshot.timetableVersions
      .filter((version) => version.isConfirmed)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  );
}

function timetableDraft(
  snapshot: AttendSafeSnapshot,
  version: TimetableVersion,
): NormalizedTimetableDraft {
  const slots = snapshot.timetableSlots.filter(
    (slot) => slot.timetableVersionId === version.id,
  );
  const timetable = snapshot.timetables.find(
    (item) => item.id === version.timetableId,
  );
  const subjects: DraftSubject[] = snapshot.subjects.map((subject) => ({
    temporaryId: subject.id,
    code: subject.code,
    name: subject.name,
    shortName: subject.shortName,
    credits: subject.credits,
    classType: subject.classType,
    faculty: [],
    isZeroCredit: subject.isZeroCredit,
    confidence: 1,
  }));
  const timetableSlots: DraftSlot[] = slots.map((slot) => ({
    temporaryId: slot.id,
    subjectTemporaryId: slot.subjectId,
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime,
    endTime: slot.endTime,
    faculty: [...slot.faculty],
    room: slot.room,
    classType:
      snapshot.subjects.find((subject) => subject.id === slot.subjectId)
        ?.classType ?? "OTHER",
    batchOptions: [...slot.batchRestriction],
    electiveGroupId: slot.electiveGroupId,
    weekPattern: slot.weekPattern,
    customWeekPattern: slot.customWeekPattern,
    notes: slot.notes,
    confidence: 1,
    isEnabled: slot.isEnabled,
    isPlaceholder: slot.isPlaceholder,
    isBreak: slot.isBreak,
  }));
  return {
    title: timetable?.title ?? "My timetable",
    timezone:
      timetable?.timezone ?? snapshot.activeProfile?.timezone ?? "Asia/Kolkata",
    days: Array.from(new Set(timetableSlots.map((slot) => slot.dayOfWeek))),
    timeSlots: Array.from(
      new Map(
        timetableSlots.map((slot) => [
          `${slot.startTime}-${slot.endTime}`,
          { startTime: slot.startTime, endTime: slot.endTime },
        ]),
      ).values(),
    ).sort((left, right) => left.startTime.localeCompare(right.startTime)),
    subjects,
    timetableSlots,
    detectedBatchOptions: Array.from(
      new Set(timetableSlots.flatMap((slot) => slot.batchOptions)),
    ),
    detectedElectiveGroups: snapshot.electiveGroups.map((group) => ({
      id: group.id,
      name: group.name,
      options: group.options.map((option) => ({
        subjectTemporaryId: option.subjectId,
        label: option.label,
      })),
      allowMultiple: group.allowMultiple ?? false,
    })),
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 1,
  };
}

function createVersionBundle(
  snapshot: AttendSafeSnapshot,
  sourceVersion: TimetableVersion,
  draft: NormalizedTimetableDraft,
  label: string,
  effectiveStartDate: string,
): TimetableBundle {
  const semester = snapshot.activeSemester;
  if (!semester) throw new Error("Choose an active semester first.");
  if (draft.subjects.length === 0 || draft.timetableSlots.length === 0) {
    throw new Error("A timetable needs at least one subject and one class.");
  }
  const now = new Date().toISOString();
  const sourceTimetable = snapshot.timetables.find(
    (timetable) => timetable.id === sourceVersion.timetableId,
  );
  const timetableId = sourceTimetable?.id ?? crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const subjectIdMap = new Map<string, string>();
  const existingSubjects = new Map(
    snapshot.subjects.map((subject) => [subject.id, subject]),
  );
  const subjects: Subject[] = draft.subjects.map((subject) => {
    const existing = existingSubjects.get(subject.temporaryId);
    const id = existing?.id ?? crypto.randomUUID();
    subjectIdMap.set(subject.temporaryId, id);
    return {
      id,
      semesterId: semester.id,
      code: subject.code,
      name: subject.name.trim(),
      shortName: subject.shortName.trim() || subject.name.slice(0, 8),
      credits: subject.credits,
      classType: subject.classType,
      minimumAttendanceBasisPointsOverride:
        existing?.minimumAttendanceBasisPointsOverride,
      safetyTargetBasisPointsOverride:
        existing?.safetyTargetBasisPointsOverride,
      isZeroCredit: subject.isZeroCredit,
      isEnabled: existing?.isEnabled ?? true,
      countsCancelledSessions: existing?.countsCancelledSessions ?? false,
      exemptPolicy: existing?.exemptPolicy ?? "EXCLUDED",
      initialHeld: existing?.initialHeld ?? 0,
      initialAttended: existing?.initialAttended ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });
  const electiveGroups = draft.detectedElectiveGroups.map((group) => {
    const existing = snapshot.electiveGroups.find(
      (item) => item.id === group.id,
    );
    return {
      id: existing?.id ?? crypto.randomUUID(),
      semesterId: semester.id,
      name: group.name,
      options: group.options.flatMap((option) => {
        const subjectId = subjectIdMap.get(option.subjectTemporaryId);
        return subjectId ? [{ subjectId, label: option.label }] : [];
      }),
      selectedSubjectIds:
        existing?.selectedSubjectIds.filter((id) =>
          subjects.some((subject) => subject.id === id),
        ) ?? [],
      allowMultiple: group.allowMultiple ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });
  const electiveIdMap = new Map(
    draft.detectedElectiveGroups.map((group, index) => [
      group.id,
      electiveGroups[index]?.id,
    ]),
  );
  const slots: TimetableSlot[] = draft.timetableSlots.map((slot) => ({
    id: crypto.randomUUID(),
    timetableVersionId: versionId,
    subjectId: slot.subjectTemporaryId
      ? subjectIdMap.get(slot.subjectTemporaryId)
      : undefined,
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime,
    endTime: slot.endTime,
    faculty: [...slot.faculty],
    room: slot.room,
    batchRestriction: [...slot.batchOptions],
    electiveGroupId: slot.electiveGroupId
      ? electiveIdMap.get(slot.electiveGroupId)
      : undefined,
    weekPattern: slot.weekPattern,
    customWeekPattern: slot.customWeekPattern,
    notes: slot.notes,
    isEnabled: slot.isEnabled,
    isPlaceholder: slot.isPlaceholder,
    isBreak: slot.isBreak,
    createdAt: now,
    updatedAt: now,
  }));
  const duplicates = detectDuplicateSlots(slots);
  const conflicts = detectSlotConflicts(slots);
  if (duplicates.length > 0 || conflicts.length > 0) {
    throw new Error(
      `Resolve ${duplicates.length} duplicate group(s) and ${conflicts.length} timetable conflict(s) before saving.`,
    );
  }
  const versionNumber =
    Math.max(
      0,
      ...snapshot.timetableVersions
        .filter((version) => version.timetableId === timetableId)
        .map((version) => version.version),
    ) + 1;
  return {
    timetable: sourceTimetable
      ? { ...sourceTimetable, title: draft.title.trim(), updatedAt: now }
      : {
          id: timetableId,
          semesterId: semester.id,
          title: draft.title.trim() || "My timetable",
          timezone: draft.timezone,
          createdAt: now,
          updatedAt: now,
        },
    version: {
      id: versionId,
      timetableId,
      semesterId: semester.id,
      version: versionNumber,
      label: label.trim() || `Version ${versionNumber}`,
      effectiveStartDate,
      isConfirmed: true,
      source: "MANUAL",
      createdAt: now,
      updatedAt: now,
    },
    subjects,
    electiveGroups,
    slots,
    activate: true,
    supersedesVersionId: sourceVersion.id,
  };
}

function SlotPill({
  slot,
  subject,
  active,
  onClick,
}: {
  slot: TimetableSlot;
  subject?: Subject;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`timetable-slot-${slot.id}`}
      className={cn(
        "border-primary/15 bg-primary-soft text-primary hover:border-primary/40 focus-visible:ring-primary w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none",
        slot.isBreak && "border-border bg-secondary text-muted-foreground",
        slot.isPlaceholder &&
          "bg-warning-soft text-warning-strong border-dashed",
        active && "ring-primary ring-offset-background ring-2 ring-offset-2",
      )}
    >
      <span className="block truncate text-sm font-extrabold">
        {slot.isBreak
          ? "Break"
          : subject?.shortName || subject?.name || "Unassigned"}
      </span>
      <span className="mt-1 block text-xs">
        {formatClockTime(slot.startTime)}–{formatClockTime(slot.endTime)}
      </span>
      {slot.room ? (
        <span className="mt-1 block truncate text-[11px]">{slot.room}</span>
      ) : null}
    </button>
  );
}

export function TimetableScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>("MONDAY");
  const [selectedSlotId, setSelectedSlotId] = useState<string>();
  const [versionEditorOpen, setVersionEditorOpen] = useState(false);
  const [draft, setDraft] = useState<NormalizedTimetableDraft>();
  const [versionLabel, setVersionLabel] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const [initialEditSlotId, setInitialEditSlotId] = useState<string>();
  const [presentation, setPresentation] = useState<"AGENDA" | "WEEK">("AGENDA");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem("attendsafe-timetable-view");
      if (stored === "AGENDA" || stored === "WEEK") {
        setPresentation(stored);
      } else if (window.matchMedia("(min-width: 1024px)").matches) {
        setPresentation("WEEK");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changePresentation = (next: "AGENDA" | "WEEK") => {
    setPresentation(next);
    localStorage.setItem("attendsafe-timetable-view", next);
  };

  const today = data
    ? isoDateInTimeZone(new Date(), data.activeProfile?.timezone)
    : new Date().toISOString().slice(0, 10);
  const version = data ? activeVersionFor(data, today) : undefined;
  const allVersionSlots =
    data && version
      ? data.timetableSlots.filter(
          (slot) => slot.timetableVersionId === version.id,
        )
      : [];
  const visibleSlots = (() => {
    if (!data) return [] as TimetableSlot[];
    const filtered = filterTimetableSlots({
      slots: allVersionSlots,
      subjects: data.subjects,
      electiveGroups: data.electiveGroups,
      selectedBatch: data.settings.selectedBatch,
      trackedClassTypes: data.settings.trackedClassTypes,
      includeZeroCredit: data.settings.includeZeroCredit ?? false,
      includePlaceholders: true,
      includeBreaks: true,
    });
    const ids = new Set(filtered.map((slot) => slot.id));
    return allVersionSlots.filter(
      (slot) => ids.has(slot.id) || (slot.isBreak && slot.isEnabled),
    );
  })();
  const subjectsById = new Map(
    data?.subjects.map((subject) => [subject.id, subject]) ?? [],
  );
  const subjectViews = data ? buildSubjectViews(data) : [];
  const dayNow = data ? currentDay(data.activeProfile?.timezone) : "MONDAY";
  const timeNow = data ? currentTime(data.activeProfile?.timezone) : "00:00";
  const visibleDays = (() => {
    const days = new Set<DayOfWeek>([
      ...FALLBACK_DAYS,
      ...visibleSlots.map((slot) => slot.dayOfWeek),
    ]);
    return DAYS_OF_WEEK.filter((day) => days.has(day));
  })();
  const displayedDay = visibleDays.includes(selectedDay)
    ? selectedDay
    : visibleDays.includes(dayNow)
      ? dayNow
      : (visibleDays[0] ?? "MONDAY");

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Loading your timetable" />;
  }
  if (availability !== "READY" || !data) {
    return (
      <AttendanceUnavailableState
        kind={
          availability === "UNSUPPORTED" || availability === "CORRUPT"
            ? availability
            : "ERROR"
        }
        message={error?.message}
        onRetry={refresh}
      />
    );
  }
  if (!data.activeProfile || !data.activeSemester) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Set up your semester first"
        description="Add a profile and timetable before opening the weekly schedule."
        action={
          <Link href="/" className={buttonClassName()}>
            Start setup
          </Link>
        }
      />
    );
  }
  if (!version) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No confirmed timetable yet"
        description="Return to setup to upload a timetable, build one manually, or try the demo."
        action={
          <Link href="/" className={buttonClassName()}>
            Build timetable
          </Link>
        }
      />
    );
  }

  const selectedSlot = allVersionSlots.find(
    (slot) => slot.id === selectedSlotId,
  );
  const selectedSubject = selectedSlot?.subjectId
    ? subjectsById.get(selectedSlot.subjectId)
    : undefined;
  const selectedView = selectedSubject
    ? viewForSubject(subjectViews, selectedSubject.id)
    : undefined;
  const todaySession = selectedSlot
    ? resolveSnapshotSessionsForDate(data, today).find(
        (session) => session.timetableSlotId === selectedSlot.id,
      )
    : undefined;
  const timeRows = Array.from(
    new Set(visibleSlots.map((slot) => slot.startTime)),
  ).sort();

  const markToday = async (status: AttendanceStatus) => {
    if (!todaySession) return;
    try {
      await attendSafeRepository.upsertSession(
        toClassSession(todaySession),
        "Prepared a timetable class for attendance",
      );
      await attendSafeRepository.markAttendance(todaySession.id, status);
      toast.success(status === "PRESENT" ? "Marked present" : "Marked absent");
      setSelectedSlotId(undefined);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not update attendance.",
      );
    }
  };

  const openVersionEditor = (slotId?: string) => {
    setDraft(timetableDraft(data, version));
    setInitialEditSlotId(slotId);
    setVersionLabel(
      `Updated ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date())}`,
    );
    setEffectiveDate(
      today < data.activeSemester!.startDate
        ? data.activeSemester!.startDate
        : today,
    );
    setVersionEditorOpen(true);
  };

  return (
    <div
      className="grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
      data-testid="timetable-screen"
    >
      <section className="border-border bg-surface flex max-w-full min-w-0 flex-col gap-4 overflow-hidden rounded-3xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">Version {version.version}</Badge>
            <Badge tone="safe">Confirmed</Badge>
            <span className="text-muted-foreground text-xs">
              Effective {version.effectiveStartDate}
            </span>
          </div>
          <h2 className="font-display mt-3 text-2xl font-extrabold tracking-tight break-words">
            {data.timetables.find((item) => item.id === version.timetableId)
              ?.title ?? "My timetable"}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Showing your batch, selected electives, and tracked class types
            only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/settings#timetable-versions"
            className={buttonClassName({ variant: "outline" })}
          >
            <History className="size-4" /> Version history
          </Link>
          <Button onClick={() => openVersionEditor()}>
            <Pencil className="size-4" /> Edit timetable
          </Button>
        </div>
      </section>

      {visibleSlots.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No classes match your filters"
          description="Your current batch, elective, or tracked class-type choices hide every active slot. Review them in Settings."
          action={
            <Link
              href="/settings"
              className={buttonClassName({ variant: "outline" })}
            >
              Review settings
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div
              className="bg-secondary flex rounded-xl p-1"
              aria-label="Timetable presentation"
            >
              <Button
                size="sm"
                variant={presentation === "AGENDA" ? "primary" : "ghost"}
                aria-pressed={presentation === "AGENDA"}
                onClick={() => changePresentation("AGENDA")}
              >
                <List className="size-4" /> Agenda
              </Button>
              <Button
                size="sm"
                variant={presentation === "WEEK" ? "primary" : "ghost"}
                aria-pressed={presentation === "WEEK"}
                onClick={() => changePresentation("WEEK")}
              >
                <LayoutGrid className="size-4" /> Week
              </Button>
            </div>
            {presentation === "WEEK" ? (
              <p
                className="text-muted-foreground text-xs"
                id="week-scroll-hint"
              >
                Scroll sideways to see every day
              </p>
            ) : null}
          </div>

          {presentation === "AGENDA" ? (
            <section aria-label="Timetable agenda">
              <div
                className="scrollbar-none flex w-full max-w-full gap-2 overflow-x-auto pb-3"
                role="tablist"
                aria-label="Timetable day"
              >
                {visibleDays.map((day) => {
                  const count = visibleSlots.filter(
                    (slot) => slot.dayOfWeek === day,
                  ).length;
                  return (
                    <button
                      key={day}
                      type="button"
                      role="tab"
                      aria-selected={displayedDay === day}
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        "border-border bg-surface text-muted-foreground min-w-20 rounded-xl border px-3 py-2 text-sm font-bold",
                        displayedDay === day &&
                          "border-primary bg-primary-soft text-primary",
                      )}
                    >
                      {titleCase(day).slice(0, 3)}
                      <span className="mt-0.5 block text-[10px] font-medium">
                        {count} classes
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3">
                {visibleSlots
                  .filter((slot) => slot.dayOfWeek === displayedDay)
                  .sort((left, right) =>
                    left.startTime.localeCompare(right.startTime),
                  )
                  .map((slot) => (
                    <SlotPill
                      key={slot.id}
                      slot={slot}
                      subject={
                        slot.subjectId
                          ? subjectsById.get(slot.subjectId)
                          : undefined
                      }
                      active={
                        displayedDay === dayNow &&
                        slot.startTime <= timeNow &&
                        timeNow < slot.endTime
                      }
                      onClick={() => setSelectedSlotId(slot.id)}
                    />
                  ))}
                {visibleSlots.every(
                  (slot) => slot.dayOfWeek !== displayedDay,
                ) ? (
                  <Card className="text-muted-foreground border-dashed p-8 text-center text-sm">
                    No classes scheduled.
                  </Card>
                ) : null}
              </div>
            </section>
          ) : null}

          {presentation === "WEEK" ? (
            <section
              className="border-border bg-surface overflow-hidden rounded-2xl border"
              aria-label="Weekly timetable"
              aria-describedby="week-scroll-hint"
            >
              <div
                className="overflow-x-auto overscroll-x-contain"
                tabIndex={0}
              >
                <div className="min-w-[1180px]">
                  <div className="border-border bg-secondary/60 grid grid-cols-[88px_repeat(7,minmax(145px,1fr))] border-b">
                    <div className="text-muted-foreground p-3 text-xs font-bold tracking-wider uppercase">
                      Time
                    </div>
                    {visibleDays.map((day) => (
                      <div
                        key={day}
                        className={cn(
                          "border-border border-l p-3 text-center text-xs font-bold tracking-wider uppercase",
                          day === dayNow && "bg-primary-soft text-primary",
                        )}
                      >
                        {titleCase(day)}
                      </div>
                    ))}
                  </div>
                  {timeRows.map((time) => (
                    <div
                      key={time}
                      className="border-border grid min-h-28 grid-cols-[88px_repeat(7,minmax(145px,1fr))] border-b last:border-b-0"
                    >
                      <div className="text-muted-foreground p-3 text-sm font-semibold">
                        {formatClockTime(time)}
                      </div>
                      {visibleDays.map((day) => (
                        <div
                          key={day}
                          className="border-border grid content-start gap-2 border-l p-2"
                        >
                          {visibleSlots
                            .filter(
                              (slot) =>
                                slot.dayOfWeek === day &&
                                slot.startTime === time,
                            )
                            .map((slot) => (
                              <SlotPill
                                key={slot.id}
                                slot={slot}
                                subject={
                                  slot.subjectId
                                    ? subjectsById.get(slot.subjectId)
                                    : undefined
                                }
                                active={
                                  day === dayNow &&
                                  slot.startTime <= timeNow &&
                                  timeNow < slot.endTime
                                }
                                onClick={() => setSelectedSlotId(slot.id)}
                              />
                            ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}

      <Dialog
        open={Boolean(selectedSlot)}
        onClose={() => setSelectedSlotId(undefined)}
        title={
          selectedSlot?.isBreak
            ? "Break"
            : (selectedSubject?.name ?? "Timetable entry")
        }
        description={
          selectedSubject?.code
            ? `${selectedSubject.code} · ${titleCase(selectedSubject.classType)}`
            : undefined
        }
      >
        {selectedSlot ? (
          <div className="grid gap-5">
            <div className="bg-secondary/65 grid gap-3 rounded-2xl p-4 sm:grid-cols-2">
              <p className="flex items-center gap-2 text-sm">
                <Clock3 className="text-primary size-4" />{" "}
                {titleCase(selectedSlot.dayOfWeek)},{" "}
                {formatClockTime(selectedSlot.startTime)}–
                {formatClockTime(selectedSlot.endTime)}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <MapPin className="text-primary size-4" />{" "}
                {selectedSlot.room || "Room not set"}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <Users className="text-primary size-4" />{" "}
                {selectedSlot.faculty.join(", ") || "Faculty not set"}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <RotateCcw className="text-primary size-4" />{" "}
                {titleCase(selectedSlot.weekPattern)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedSlot.batchRestriction.map((batch) => (
                <Badge key={batch} tone="info">
                  Batch {batch}
                </Badge>
              ))}
              {selectedSlot.isPlaceholder ? (
                <Badge tone="caution">Static placeholder</Badge>
              ) : null}
              {!selectedSlot.isEnabled ? (
                <Badge tone="neutral">Disabled</Badge>
              ) : null}
            </div>
            {selectedView ? (
              <Card className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                      Current attendance
                    </p>
                    <p className="mt-1 text-2xl font-black">
                      {displayPercentage(
                        selectedView.summary.percentageBasisPoints,
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {selectedView.summary.attended} attended of{" "}
                      {selectedView.summary.held} held
                    </p>
                  </div>
                  <Badge tone={riskTone(selectedView.classification)}>
                    {titleCase(selectedView.classification)}
                  </Badge>
                </div>
                <Progress
                  className="mt-4"
                  value={
                    (selectedView.summary.percentageBasisPoints ?? 0) / 100
                  }
                  label={`${selectedSubject?.name ?? "Subject"} attendance`}
                />
              </Card>
            ) : null}
            {todaySession && selectedSlot.dayOfWeek === dayNow ? (
              <div className="border-primary/20 bg-primary-soft rounded-2xl border p-4">
                <p className="text-primary font-bold">Mark today’s class</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Current status: {titleCase(todaySession.attendanceStatus)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button onClick={() => void markToday("PRESENT")}>
                    <CheckCircle2 className="size-4" /> Present
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void markToday("ABSENT")}
                  >
                    <AlertTriangle className="size-4" /> Absent
                  </Button>
                </div>
              </div>
            ) : null}
            {selectedSlot.notes ? (
              <p className="text-muted-foreground text-sm leading-6">
                {selectedSlot.notes}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setSelectedSlotId(undefined)}
              >
                Close
              </Button>
              {selectedSubject ? (
                <Link
                  href={`/skip-planner?subject=${encodeURIComponent(selectedSubject.id)}`}
                  onClick={() => setSelectedSlotId(undefined)}
                  className={buttonClassName({ variant: "outline" })}
                >
                  Simulate skip
                </Link>
              ) : null}
              <Link
                href="/today"
                onClick={() => setSelectedSlotId(undefined)}
                className={buttonClassName({ variant: "outline" })}
              >
                <CalendarDays className="size-4" /> Add or cancel one date
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedSlotId(undefined);
                  openVersionEditor(selectedSlot.id);
                }}
              >
                <Pencil className="size-4" /> Edit this class
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={versionEditorOpen}
        onClose={() => setVersionEditorOpen(false)}
        title="Edit timetable"
        description="Tap any class to edit, move, duplicate, or delete it. Saving creates a dated version so attendance history stays intact."
      >
        {draft ? (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Version label">
                <Input
                  value={versionLabel}
                  onChange={(event) => setVersionLabel(event.target.value)}
                />
              </Field>
              <Field label="Effective from">
                <Input
                  type="date"
                  min={data.activeSemester.startDate}
                  max={data.activeSemester.endDate}
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                />
              </Field>
            </div>
            <DraftEditor
              value={draft}
              onChange={setDraft}
              initialEditSlotId={initialEditSlotId}
            />
            <div className="border-info-strong/20 bg-info-soft text-info-strong rounded-xl border p-3 text-xs leading-5">
              Saving creates an immutable version boundary. Attendance already
              recorded against older sessions is preserved.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setVersionEditorOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={savingVersion}
                onClick={async () => {
                  setSavingVersion(true);
                  try {
                    if (!effectiveDate)
                      throw new Error("Choose an effective date.");
                    const bundle = createVersionBundle(
                      data,
                      version,
                      draft,
                      versionLabel,
                      effectiveDate,
                    );
                    await attendSafeRepository.saveTimetableBundle(bundle);
                    toast.success(
                      `Timetable version ${bundle.version.version} activated`,
                    );
                    setVersionEditorOpen(false);
                    setInitialEditSlotId(undefined);
                  } catch (cause) {
                    toast.error(
                      cause instanceof Error
                        ? cause.message
                        : "Could not save this timetable version.",
                    );
                  } finally {
                    setSavingVersion(false);
                  }
                }}
              >
                {savingVersion ? "Saving…" : "Confirm & activate"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

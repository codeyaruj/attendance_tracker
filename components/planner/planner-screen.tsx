"use client";

import { CalendarRange, ListChecks, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  buildSubjectViews,
  currentAttendanceSessions,
  isoDateInTimeZone,
  resolveSnapshotSessionsInRange,
} from "@/components/attendance/attendance-view-model";
import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import { isSessionEligibleForSkip } from "@/lib/attendance";
import { DAYS_OF_WEEK, type DayOfWeek } from "@/types/domain";

import { PlannerConfirmDialog } from "./planner-confirm-dialog";
import { PlannerControls } from "./planner-controls";
import { PlannerModeTabs } from "./planner-mode-tabs";
import {
  addIsoDays,
  buildPlannerSimulation,
  buildSafestWeekRanking,
  findSafestDay,
  type PlannerMode,
} from "./planner-model";
import { persistPlannedAbsences } from "./planner-persistence";
import { PlannerProjectionPanel } from "./planner-projection-panel";

function earlierDate(left: string, right: string): string {
  return left < right ? left : right;
}

function laterDate(left: string, right: string): string {
  return left > right ? left : right;
}

function timeInTimeZone(date: Date, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function toggleId(
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  id: string,
): void {
  setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function toggleDay(
  setter: React.Dispatch<React.SetStateAction<Set<DayOfWeek>>>,
  day: DayOfWeek,
): void {
  setter((current) => {
    const next = new Set(current);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    return next;
  });
}

export function PlannerScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const [mode, setMode] = useState<PlannerMode>("SINGLE");
  const [singleSessionId, setSingleSessionId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weekday, setWeekday] = useState<DayOfWeek>("FRIDAY");
  const [recurringExcludedSubjectIds, setRecurringExcludedSubjectIds] =
    useState<Set<string>>(new Set());
  const [recurringExcludedSessionIds, setRecurringExcludedSessionIds] =
    useState<Set<string>>(new Set());
  const [safestSelectedIds, setSafestSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [theoryOnly, setTheoryOnly] = useState(false);
  const [excludeLabs, setExcludeLabs] = useState(true);
  const [excludeZeroCredit, setExcludeZeroCredit] = useState(true);
  const [safestDays, setSafestDays] = useState<Set<DayOfWeek>>(
    () => new Set(DAYS_OF_WEEK.slice(0, 5)),
  );
  const [safestExcludedSubjectIds, setSafestExcludedSubjectIds] = useState<
    Set<string>
  >(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const now = useMemo(() => new Date(), []);
  const timeZone = data?.activeProfile?.timezone;
  const today = isoDateInTimeZone(now, timeZone);
  const currentTime = timeInTimeZone(now, timeZone);
  const semester = data?.activeSemester;
  const planningStart = semester
    ? laterDate(semester.startDate, earlierDate(today, semester.endDate))
    : today;
  const maximumDate = semester?.endDate ?? today;
  const effectiveStartDate = startDate || planningStart;
  const defaultRangeEnd = semester
    ? earlierDate(addIsoDays(planningStart, 28), semester.endDate)
    : planningStart;
  const effectiveEndDate = endDate || defaultRangeEnd;

  const resolvedFutureSessions = useMemo(() => {
    if (!data?.activeSemester || today > data.activeSemester.endDate) return [];
    const rangeStart = laterDate(today, data.activeSemester.startDate);
    return resolveSnapshotSessionsInRange(
      data,
      rangeStart,
      data.activeSemester.endDate,
    );
  }, [data, today]);
  const upcomingSessions = useMemo(
    () =>
      resolvedFutureSessions.filter(
        (session) =>
          isSessionEligibleForSkip(session) &&
          (session.date > today || session.startTime >= currentTime),
      ),
    [currentTime, resolvedFutureSessions, today],
  );
  const subjectViews = useMemo(
    () =>
      data
        ? buildSubjectViews(data, currentAttendanceSessions(data, today))
        : [],
    [data, today],
  );
  const summaries = useMemo(
    () => subjectViews.map((view) => view.summary),
    [subjectViews],
  );
  const subjects = useMemo(
    () => subjectViews.map((view) => view.subject),
    [subjectViews],
  );
  const subjectsById = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject])),
    [subjects],
  );
  const effectiveSingleId =
    singleSessionId &&
    upcomingSessions.some((session) => session.id === singleSessionId)
      ? singleSessionId
      : (upcomingSessions[0]?.id ?? "");
  const effectiveSelectedDate =
    selectedDate || upcomingSessions[0]?.date || planningStart;
  const recurringSubjectIds = subjects
    .filter((subject) => !recurringExcludedSubjectIds.has(subject.id))
    .map((subject) => subject.id);
  const weekEnd = semester
    ? earlierDate(addIsoDays(planningStart, 6), semester.endDate)
    : planningStart;
  const weekSessions = upcomingSessions.filter(
    (session) => session.date >= planningStart && session.date <= weekEnd,
  );
  const safestSubjectIds = subjects
    .filter((subject) => !safestExcludedSubjectIds.has(subject.id))
    .map((subject) => subject.id);
  const safestRanking = useMemo(
    () =>
      buildSafestWeekRanking({
        summaries,
        sessions: weekSessions,
        subjects,
        filters: {
          ...(theoryOnly ? { classTypes: ["THEORY"] } : {}),
          excludeLabs,
          excludeZeroCredit,
          selectedDays: [...safestDays],
          selectedSubjectIds: safestSubjectIds,
        },
      }),
    [
      excludeLabs,
      excludeZeroCredit,
      safestDays,
      safestSubjectIds,
      summaries,
      subjects,
      theoryOnly,
      weekSessions,
    ],
  );
  const safestDay = useMemo(
    () => findSafestDay(summaries, weekSessions),
    [summaries, weekSessions],
  );
  const recurringCandidates = useMemo(
    () =>
      buildPlannerSimulation({
        mode: "WEEKDAY",
        summaries,
        sessions: upcomingSessions,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        weekday,
        includeSubjectIds: recurringSubjectIds,
      }).selectedSessions,
    [
      effectiveEndDate,
      effectiveStartDate,
      recurringSubjectIds,
      summaries,
      upcomingSessions,
      weekday,
    ],
  );
  const recurringIncludedSessionIds = new Set(
    recurringCandidates
      .filter((session) => !recurringExcludedSessionIds.has(session.id))
      .map((session) => session.id),
  );
  const simulation = useMemo(
    () =>
      buildPlannerSimulation({
        mode,
        summaries,
        sessions: upcomingSessions,
        singleSessionId: effectiveSingleId,
        selectedDate: effectiveSelectedDate,
        selectedSessionIds:
          mode === "SAFEST" ? [...safestSelectedIds] : [...selectedSessionIds],
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        weekday,
        includeSubjectIds: recurringSubjectIds,
        excludeSessionIds: [...recurringExcludedSessionIds],
      }),
    [
      effectiveEndDate,
      effectiveSelectedDate,
      effectiveSingleId,
      effectiveStartDate,
      mode,
      recurringExcludedSessionIds,
      recurringSubjectIds,
      safestSelectedIds,
      selectedSessionIds,
      summaries,
      upcomingSessions,
      weekday,
    ],
  );
  const alreadyPlannedCount = resolvedFutureSessions.filter(
    (session) => session.attendanceStatus === "ABSENT" && session.date >= today,
  ).length;

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Resolving future classes" />;
  }
  if (availability !== "READY" || !data) {
    return (
      <AttendanceUnavailableState
        kind={availability === "READY" ? "ERROR" : availability}
        message={error?.message}
        onRetry={refresh}
      />
    );
  }
  if (!data.activeProfile || !data.activeSemester) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Add your timetable first"
        description="The planner needs your semester, selected electives, batch, and current attendance before it can make a safe projection."
        action={
          <Link
            href="/"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
          >
            Start setup
          </Link>
        }
      />
    );
  }

  const openConfirmation = () => {
    if (simulation.persistenceSessions.length === 0) return;
    setConfirmOpen(true);
  };

  const confirmPlan = async () => {
    setSaving(true);
    try {
      const count = await persistPlannedAbsences(
        simulation.persistenceSessions,
      );
      toast.success(
        `${count} planned ${count === 1 ? "absence" : "absences"} saved`,
      );
      setConfirmOpen(false);
      setSelectedSessionIds(new Set());
      setSafestSelectedIds(new Set());
      await refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The planned absences could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const useSafestDay = (date: string) => {
    setSelectedDate(date);
    setMode("DAY");
  };

  return (
    <div className="grid gap-5 sm:gap-6">
      <section className="border-primary/15 overflow-hidden rounded-3xl border bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_58%)] p-5 sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <div className="text-primary flex items-center gap-2 text-xs font-bold tracking-[0.15em] uppercase">
              <Sparkles className="size-4" aria-hidden="true" /> Combined
              planning
            </div>
            <h2 className="font-display mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              Know the consequence before you miss the class.
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6 sm:text-base">
              Every result uses your actual timetable version, exceptions,
              batch, electives, and subject-specific thresholds. Simulations
              stay private on this device.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-surface/85 rounded-xl px-3 py-3 shadow-sm">
              <dt className="text-muted-foreground text-[11px]">Upcoming</dt>
              <dd className="mt-1 text-xl font-black">
                {upcomingSessions.length}
              </dd>
            </div>
            <div className="bg-surface/85 rounded-xl px-3 py-3 shadow-sm">
              <dt className="text-muted-foreground text-[11px]">Subjects</dt>
              <dd className="mt-1 text-xl font-black">{subjects.length}</dd>
            </div>
            <div className="bg-surface/85 rounded-xl px-3 py-3 shadow-sm">
              <dt className="text-muted-foreground text-[11px]">Planned</dt>
              <dd className="mt-1 text-xl font-black">{alreadyPlannedCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      <PlannerModeTabs value={mode} onChange={setMode} />

      {upcomingSessions.length === 0 && mode !== "BUFFERS" ? (
        <Card className="p-6">
          <EmptyState
            icon={CalendarRange}
            title="No unplanned classes remain"
            description="There are no future, tracked timetable sessions available in this semester. Cancelled classes, holidays, placeholders, and already planned absences are excluded automatically."
          />
        </Card>
      ) : (
        <div
          id="planner-mode-panel"
          role="tabpanel"
          className={
            mode === "BUFFERS"
              ? "grid"
              : "grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(380px,1.08fr)] xl:items-start"
          }
        >
          <Card className="p-5 sm:p-6">
            <PlannerControls
              mode={mode}
              sessions={upcomingSessions}
              subjects={subjects}
              subjectsById={subjectsById}
              minimumDate={planningStart}
              maximumDate={maximumDate}
              singleSessionId={effectiveSingleId}
              onSingleSessionChange={setSingleSessionId}
              selectedDate={effectiveSelectedDate}
              onSelectedDateChange={setSelectedDate}
              selectedSessionIds={selectedSessionIds}
              onSelectedSessionToggle={(id) =>
                toggleId(setSelectedSessionIds, id)
              }
              startDate={effectiveStartDate}
              endDate={effectiveEndDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              weekday={weekday}
              onWeekdayChange={setWeekday}
              recurringExcludedSubjectIds={recurringExcludedSubjectIds}
              onRecurringSubjectToggle={(id) =>
                toggleId(setRecurringExcludedSubjectIds, id)
              }
              recurringCandidateSessions={recurringCandidates}
              recurringIncludedSessionIds={recurringIncludedSessionIds}
              onRecurringSessionToggle={(id) =>
                toggleId(setRecurringExcludedSessionIds, id)
              }
              safestRanking={safestRanking}
              safestSelectedIds={safestSelectedIds}
              onSafestSessionToggle={(id) => toggleId(setSafestSelectedIds, id)}
              safestDay={safestDay}
              onUseSafestDay={useSafestDay}
              theoryOnly={theoryOnly}
              excludeLabs={excludeLabs}
              excludeZeroCredit={excludeZeroCredit}
              onTheoryOnlyChange={setTheoryOnly}
              onExcludeLabsChange={setExcludeLabs}
              onExcludeZeroCreditChange={setExcludeZeroCredit}
              safestDays={safestDays}
              onSafestDayToggle={(day) => toggleDay(setSafestDays, day)}
              safestExcludedSubjectIds={safestExcludedSubjectIds}
              onSafestSubjectToggle={(id) =>
                toggleId(setSafestExcludedSubjectIds, id)
              }
              subjectViews={subjectViews}
            />
          </Card>

          {mode !== "BUFFERS" ? (
            <div className="xl:sticky xl:top-24">
              <PlannerProjectionPanel
                simulation={simulation.simulation}
                fullDayPlan={simulation.fullDayPlan}
                persistenceSessions={simulation.persistenceSessions}
                subjectsById={subjectsById}
                onPlanAbsences={openConfirmation}
                saving={saving}
              />
            </div>
          ) : null}
        </div>
      )}

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Planner guarantees"
      >
        {[
          {
            icon: ListChecks,
            title: "Combined math",
            text: "Repeated subjects are aggregated before classification.",
          },
          {
            icon: CalendarRange,
            title: "Real sessions",
            text: "Versions, holidays, cancellations, and extras are resolved first.",
          },
          {
            icon: ShieldCheck,
            title: "Confirmation only",
            text: "Trying scenarios never writes attendance by itself.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="bg-secondary/70 flex gap-3 rounded-xl p-4"
          >
            <item.icon
              className="text-primary mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs font-bold">{item.title}</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {item.text}
              </p>
            </div>
          </div>
        ))}
      </section>

      <PlannerConfirmDialog
        open={confirmOpen}
        sessions={simulation.persistenceSessions}
        busy={saving}
        unsafe={!simulation.simulation.meetsMinimum}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmPlan}
      />
    </div>
  );
}

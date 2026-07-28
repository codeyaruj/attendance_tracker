"use client";

import { addDays, endOfWeek, format, parseISO } from "date-fns";
import { AlertTriangle, ArrowUpDown, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import {
  buildSubjectViews,
  currentAttendanceSessions,
  isoDateInTimeZone,
  resolveSnapshotSessionsForDate,
  type SubjectAttendanceView,
  unmarkedHistoricalSessions,
} from "@/components/attendance/attendance-view-model";
import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { SubjectAttendanceCard } from "@/components/dashboard/subject-attendance-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form-controls";
import type { AttendSafeSnapshot } from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import { planFullDaySkip } from "@/lib/attendance";

type DashboardSort =
  "LOWEST" | "HIGHEST" | "SKIPPABLE" | "RECOVERY" | "ALPHABETICAL";

function compareNullable(
  left: number | null,
  right: number | null,
  descending = false,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

export function sortSubjectViews(
  views: readonly SubjectAttendanceView[],
  sort: DashboardSort,
): SubjectAttendanceView[] {
  return views.slice().sort((left, right) => {
    switch (sort) {
      case "LOWEST":
        return (
          compareNullable(
            left.summary.percentageBasisPoints,
            right.summary.percentageBasisPoints,
          ) || left.subject.name.localeCompare(right.subject.name)
        );
      case "HIGHEST":
        return (
          compareNullable(
            left.summary.percentageBasisPoints,
            right.summary.percentageBasisPoints,
            true,
          ) || left.subject.name.localeCompare(right.subject.name)
        );
      case "SKIPPABLE":
        return (
          right.skippable - left.skippable ||
          left.subject.name.localeCompare(right.subject.name)
        );
      case "RECOVERY":
        return (
          right.recovery - left.recovery ||
          left.subject.name.localeCompare(right.subject.name)
        );
      case "ALPHABETICAL":
        return left.subject.name.localeCompare(right.subject.name);
    }
  });
}

function timeInTimeZone(timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function safestDayThisWeek(
  snapshot: AttendSafeSnapshot,
  views: readonly SubjectAttendanceView[],
  today: string,
): string {
  const start = parseISO(today);
  const weekStartsOn =
    snapshot.activeProfile?.weekStartsOn === "SUNDAY" ? 0 : 1;
  const end = endOfWeek(start, { weekStartsOn });
  const summaries = views.map((view) => view.summary);
  const candidates: Array<{ date: string; rank: number; margin: number }> = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = format(cursor, "yyyy-MM-dd");
    const sessions = resolveSnapshotSessionsForDate(snapshot, date);
    const plan = planFullDaySkip({ summaries, sessions });
    if (plan.selectedSessions.length === 0 || !plan.meetsMinimum) continue;
    const margin = Math.min(
      ...plan.subjectProjections.map(
        (projection) =>
          (projection.projectedPercentageBasisPoints ?? 0) -
          projection.minimumBasisPoints,
      ),
    );
    candidates.push({ date, rank: plan.meetsSafetyTarget ? 2 : 1, margin });
  }
  const best = candidates.sort(
    (left, right) =>
      right.rank - left.rank ||
      right.margin - left.margin ||
      left.date.localeCompare(right.date),
  )[0];
  return best ? format(parseISO(best.date), "EEEE") : "None safe";
}

export function DashboardScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const [sort, setSort] = useState<DashboardSort>("LOWEST");
  const today = isoDateInTimeZone(new Date(), data?.activeProfile?.timezone);
  const attendanceSessions = useMemo(
    () => (data ? currentAttendanceSessions(data, today) : []),
    [data, today],
  );
  const subjectViews = useMemo(
    () => (data ? buildSubjectViews(data, attendanceSessions) : []),
    [attendanceSessions, data],
  );
  const sortedViews = useMemo(
    () => sortSubjectViews(subjectViews, sort),
    [sort, subjectViews],
  );
  const unmarkedHistoricalCount = useMemo(
    () => (data ? unmarkedHistoricalSessions(data, today).length : 0),
    [data, today],
  );

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Calculating subject attendance" />;
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
  if (!data.activeSemester) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="Your dashboard is waiting"
        description="Complete semester setup to see exact subject-level attendance and skip buffers."
        action={
          <Link
            href="/"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
          >
            Set up AttendSafe
          </Link>
        }
      />
    );
  }

  const nowTime = timeInTimeZone(data.activeProfile?.timezone);
  const todaySessions = resolveSnapshotSessionsForDate(data, today);
  const upcomingToday = todaySessions.filter(
    (session) =>
      session.startTime >= nowTime &&
      session.status !== "CANCELLED" &&
      session.status !== "HOLIDAY" &&
      session.status !== "NOT_CONDUCTED",
  ).length;
  const belowMinimum = subjectViews.filter(
    (view) => view.classification === "UNSAFE",
  ).length;
  const belowSafety = subjectViews.filter(
    (view) =>
      view.summary.percentageBasisPoints !== null &&
      view.summary.percentageBasisPoints < view.summary.safetyBasisPoints,
  ).length;
  const safestDay = safestDayThisWeek(data, subjectViews, today);

  return (
    <div className="grid gap-5" data-testid="dashboard-page">
      <section aria-labelledby="attendance-overview-title">
        <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
          {data.activeSemester.name}
        </p>
        <h2
          id="attendance-overview-title"
          className="font-display mt-1 text-2xl font-black tracking-tight sm:text-3xl"
        >
          Attendance overview
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">
          Counts include only conducted sessions and your configured
          cancellation and exemption policies.
        </p>
      </section>

      {unmarkedHistoricalCount > 0 ? (
        <div
          role="status"
          data-testid="projection-incomplete-warning"
          className="border-warning/35 bg-warning/10 text-foreground flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle
              className="text-warning mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Attendance projections exclude {unmarkedHistoricalCount} unmarked
            historical {unmarkedHistoricalCount === 1 ? "class" : "classes"}.
          </span>
          <Link
            href="/history#backfill-attendance"
            className="text-primary inline-flex min-h-11 shrink-0 items-center font-bold underline-offset-4 hover:underline"
          >
            Add attendance
          </Link>
        </div>
      ) : null}

      <DashboardSummary
        values={{
          tracked: subjectViews.length,
          minimum: belowMinimum,
          safety: belowSafety,
          safest: safestDay,
          upcoming: upcomingToday,
        }}
      />

      <section aria-labelledby="subject-health-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="subject-health-title"
              className="font-display text-xl font-extrabold"
            >
              Subject health
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Exact counts, targets, and your next-absence projection.
            </p>
          </div>
          <label className="text-muted-foreground grid gap-1 text-xs font-semibold sm:w-56">
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpDown className="size-3.5" aria-hidden="true" /> Sort
              subjects
            </span>
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value as DashboardSort)}
              data-testid="dashboard-sort"
            >
              <option value="LOWEST">Lowest attendance</option>
              <option value="HIGHEST">Highest attendance</option>
              <option value="SKIPPABLE">Most skippable</option>
              <option value="RECOVERY">Most recovery needed</option>
              <option value="ALPHABETICAL">Alphabetical</option>
            </Select>
          </label>
        </div>

        {sortedViews.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No tracked subjects"
            description="Enable at least one subject in timetable settings to start tracking attendance."
          />
        ) : (
          <div
            className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"
            data-testid="subject-card-list"
          >
            {sortedViews.map((view) => (
              <SubjectAttendanceCard key={view.subject.id} view={view} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

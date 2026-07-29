"use client";

import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  History,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmActionDialog } from "@/components/attendance/confirm-action-dialog";
import type { ConfirmAction } from "@/components/attendance/confirm-action-dialog";
import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import { RecentActionsCard } from "@/components/attendance/recent-actions-card";
import {
  isoDateInTimeZone,
  resolveSnapshotHistoricalSessionsInRange,
  toClassSession,
  unmarkedHistoricalSessions,
} from "@/components/attendance/attendance-view-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form-controls";
import { attendSafeRepository, type MarkAttendanceStatus } from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";

import {
  EditAttendanceDialog,
  type EditAttendanceValues,
} from "./edit-attendance-dialog";
import { HistoryCalendar } from "./history-calendar";
import { HistoryEntryCard } from "./history-entry-card";
import { HistoryFilters, type HistoryFilterValues } from "./history-filters";
import {
  buildHistoryEntries,
  historyStatusLabel,
  type HistoryEntry,
} from "./history-view-model";

const initialFilters: HistoryFilterValues = {
  query: "",
  subjectId: "ALL",
  status: "ALL",
  startDate: "",
  endDate: "",
};

type BackfillBulkStatus = Extract<
  MarkAttendanceStatus,
  "PRESENT" | "NOT_CONDUCTED" | "NOT_MARKED"
>;

function bulkConfirmation(
  status: BackfillBulkStatus,
  sessionCount: number,
  overwriteCount: number,
): ConfirmAction {
  const overwriteWarning = overwriteCount
    ? ` ${overwriteCount} already marked ${overwriteCount === 1 ? "class" : "classes"} will be replaced.`
    : " No existing attendance marks will be replaced.";
  switch (status) {
    case "PRESENT":
      return {
        title: "Mark the whole day present?",
        description: `${sessionCount} scheduled ${sessionCount === 1 ? "class" : "classes"} will be marked present.${overwriteWarning}`,
        confirmLabel: "Mark whole day present",
      };
    case "NOT_CONDUCTED":
      return {
        title: "Mark the whole day not conducted?",
        description: `${sessionCount} scheduled ${sessionCount === 1 ? "class" : "classes"} will be excluded from held-class totals.${overwriteWarning}`,
        confirmLabel: "Mark whole day not conducted",
      };
    case "NOT_MARKED":
      return {
        title: "Leave the whole day unknown?",
        description: `${sessionCount} scheduled ${sessionCount === 1 ? "class" : "classes"} will have no attendance mark and will not count as absent.${overwriteWarning}`,
        confirmLabel: "Leave whole day unknown",
      };
  }
}

function matchesSearch(entry: HistoryEntry, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [
    entry.subject.name,
    entry.subject.shortName,
    entry.subject.code,
    entry.session.room,
    entry.session.faculty.join(" "),
    entry.session.notes,
    entry.record?.notes,
    historyStatusLabel(entry.status),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(query.trim().toLocaleLowerCase());
}

export function HistoryScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const today = isoDateInTimeZone(new Date(), data?.activeProfile?.timezone);
  const [filters, setFilters] = useState<HistoryFilterValues>(initialFilters);
  const [month, setMonth] = useState(() => parseISO(today));
  const [editing, setEditing] = useState<HistoryEntry>();
  const [resetting, setResetting] = useState<HistoryEntry>();
  const [backfillDate, setBackfillDate] = useState("");
  const [bulkStatus, setBulkStatus] = useState<BackfillBulkStatus>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [undoingId, setUndoingId] = useState<string>();
  const [incompleteDismissed, setIncompleteDismissed] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const sessions = useMemo(() => {
    const semester = data?.activeSemester;
    if (!data || !semester || today < semester.startDate) return [];
    return resolveSnapshotHistoricalSessionsInRange(
      data,
      semester.startDate,
      today < semester.endDate ? today : semester.endDate,
    );
  }, [data, today]);
  const entries = useMemo(
    () => (data ? buildHistoryEntries(data, sessions) : []),
    [data, sessions],
  );
  const visibleEntries = useMemo(
    () =>
      entries
        .filter((entry) => {
          if (filters.status === "ALL" && !entry.isActivity) return false;
          if (filters.status !== "ALL" && entry.status !== filters.status)
            return false;
          if (
            filters.subjectId !== "ALL" &&
            entry.subject.id !== filters.subjectId
          )
            return false;
          if (filters.startDate && entry.session.date < filters.startDate)
            return false;
          if (filters.endDate && entry.session.date > filters.endDate)
            return false;
          return matchesSearch(entry, filters.query);
        })
        .sort(
          (left, right) =>
            right.session.date.localeCompare(left.session.date) ||
            right.session.startTime.localeCompare(left.session.startTime) ||
            right.id.localeCompare(left.id),
        ),
    [entries, filters],
  );
  const incompleteSessions = useMemo(
    () => (data ? unmarkedHistoricalSessions(data, today) : []),
    [data, today],
  );

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Opening attendance history" />;
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
        icon={History}
        title="No attendance history yet"
        description="Complete semester setup, then your daily attendance changes will appear here."
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
  if (today < data.activeSemester.startDate) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Historical attendance starts with your semester"
        description={`Backfill will be available from ${format(parseISO(data.activeSemester.startDate), "d MMMM yyyy")}. Future attendance cannot be marked in advance.`}
      />
    );
  }

  const semester = data.activeSemester;
  const maximumBackfillDate =
    today < semester.endDate ? today : semester.endDate;
  const effectiveBackfillDate =
    backfillDate >= semester.startDate && backfillDate <= maximumBackfillDate
      ? backfillDate
      : maximumBackfillDate;
  const backfillEntries = entries.filter(
    (entry) => entry.session.date === effectiveBackfillDate,
  );
  const markableBackfillEntries = backfillEntries.filter(
    (entry) => entry.isBackfillable,
  );
  const overwriteCount = markableBackfillEntries.filter(
    (entry) => entry.wouldOverwriteExistingMark,
  ).length;

  const saveEdit = async (values: EditAttendanceValues) => {
    if (!editing) return;
    setEditBusy(true);
    try {
      if (editing.session.date > maximumBackfillDate) {
        throw new Error("Future attendance cannot be changed.");
      }
      await attendSafeRepository.backfillAttendance(
        [
          {
            session: toClassSession(editing.session),
            status: values.status,
            ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
          },
        ],
        maximumBackfillDate,
        editing.isUnmarked
          ? "Backfilled historical attendance"
          : "Corrected historical attendance",
      );
      setEditing(undefined);
      toast.success(
        values.status === "NOT_MARKED"
          ? "Attendance left unknown"
          : editing.isUnmarked
            ? "Historical attendance saved"
            : "Attendance correction saved",
      );
      await refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The correction could not be saved.",
      );
    } finally {
      setEditBusy(false);
    }
  };

  const resetRecord = async () => {
    if (!resetting) return;
    setResetBusy(true);
    try {
      await attendSafeRepository.backfillAttendance(
        [
          {
            session: toClassSession(resetting.session),
            status: "NOT_MARKED",
          },
        ],
        maximumBackfillDate,
        "Left historical attendance unknown",
      );
      setResetting(undefined);
      toast.success("Attendance left unknown");
      await refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The record could not be reset.",
      );
    } finally {
      setResetBusy(false);
    }
  };

  const runBulkBackfill = async () => {
    if (!bulkStatus || markableBackfillEntries.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await attendSafeRepository.backfillAttendance(
        markableBackfillEntries.map((entry) => ({
          session: toClassSession(entry.session),
          status: bulkStatus,
        })),
        maximumBackfillDate,
        bulkStatus === "PRESENT"
          ? "Marked a historical day present"
          : bulkStatus === "NOT_CONDUCTED"
            ? "Marked a historical day not conducted"
            : "Left a historical day unknown",
      );
      setBulkStatus(undefined);
      toast.success(
        result.changedCount
          ? `${result.changedCount} ${result.changedCount === 1 ? "class" : "classes"} updated`
          : "The day was already in that state",
      );
      await refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Historical attendance could not be updated.",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const undoAction = async (action: { id: string }) => {
    setUndoingId(action.id);
    try {
      await attendSafeRepository.undo(action.id);
      toast.success("Change undone");
      await refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The change could not be undone.",
      );
    } finally {
      setUndoingId(undefined);
    }
  };

  const activityEntries = entries.filter((entry) => entry.isActivity);
  const presentCount = activityEntries.filter(
    (entry) => entry.status === "PRESENT",
  ).length;
  const absentCount = activityEntries.filter(
    (entry) => entry.status === "ABSENT",
  ).length;
  const invalidRange = Boolean(
    filters.startDate && filters.endDate && filters.startDate > filters.endDate,
  );

  return (
    <div
      className="grid gap-5"
      data-testid="history-page"
      data-pwa-critical-operation={
        bulkBusy || editBusy || resetBusy || Boolean(undoingId)
          ? "true"
          : undefined
      }
    >
      <section className="grid grid-cols-3 gap-3" aria-label="History summary">
        <Card className="p-4">
          <CalendarRange className="text-primary size-5" aria-hidden="true" />
          <p className="mt-3 text-2xl font-black">{activityEntries.length}</p>
          <p className="text-muted-foreground text-xs font-semibold">
            Recorded changes
          </p>
        </Card>
        <Card className="p-4">
          <CheckCircle2
            className="text-safe-strong size-5"
            aria-hidden="true"
          />
          <p className="mt-3 text-2xl font-black">{presentCount}</p>
          <p className="text-muted-foreground text-xs font-semibold">Present</p>
        </Card>
        <Card className="p-4">
          <XCircle className="text-danger size-5" aria-hidden="true" />
          <p className="mt-3 text-2xl font-black">{absentCount}</p>
          <p className="text-muted-foreground text-xs font-semibold">Absent</p>
        </Card>
      </section>

      {incompleteSessions.length > 0 && !incompleteDismissed ? (
        <section
          className="border-warning/30 bg-warning-soft text-warning-strong rounded-2xl border p-4"
          aria-labelledby="incomplete-attendance-title"
          data-testid="incomplete-attendance-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h2 id="incomplete-attendance-title" className="font-extrabold">
                Historical attendance is incomplete
              </h2>
              <p className="mt-1 text-sm leading-6">
                {incompleteSessions.length} historical{" "}
                {incompleteSessions.length === 1 ? "class is" : "classes are"}{" "}
                still unmarked. Add attendance now or leave it unknown until you
                confirm which classes were held.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const date = incompleteSessions[0]?.date;
                    if (date) {
                      setBackfillDate(date);
                      setMonth(parseISO(date));
                      document
                        .getElementById("backfill-attendance")
                        ?.scrollIntoView({ block: "start" });
                    }
                  }}
                >
                  Add attendance
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIncompleteDismissed(true)}
                >
                  Dismiss for now
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section id="backfill-attendance" aria-labelledby="backfill-title">
        <Card className="p-4 sm:p-5" data-testid="backfill-attendance">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-primary flex items-center gap-2 text-xs font-bold tracking-[0.14em] uppercase">
                <CalendarClock className="size-4" aria-hidden="true" /> Backfill
                attendance
              </p>
              <h2
                id="backfill-title"
                className="font-display mt-1 text-xl font-extrabold"
              >
                Add attendance for a past date
              </h2>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Opening a date does not save anything. Unknown classes remain
                excluded from attendance totals.
              </p>
            </div>
            <div className="w-full lg:w-56">
              <Field label="Attendance date">
                <Input
                  type="date"
                  min={semester.startDate}
                  max={maximumBackfillDate}
                  value={effectiveBackfillDate}
                  onChange={(event) => {
                    const date = event.target.value;
                    if (
                      date >= semester.startDate &&
                      date <= maximumBackfillDate
                    ) {
                      setBackfillDate(date);
                      setMonth(parseISO(date));
                    }
                  }}
                  data-testid="backfill-date"
                />
              </Field>
            </div>
          </div>

          <div
            className="border-border mt-4 flex flex-wrap gap-2 border-t pt-4"
            aria-label="Whole-day attendance actions"
          >
            <Button
              size="sm"
              onClick={() => setBulkStatus("PRESENT")}
              disabled={markableBackfillEntries.length === 0 || bulkBusy}
            >
              Mark whole day present
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkStatus("NOT_CONDUCTED")}
              disabled={markableBackfillEntries.length === 0 || bulkBusy}
            >
              Mark whole day not conducted
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBulkStatus("NOT_MARKED")}
              disabled={markableBackfillEntries.length === 0 || bulkBusy}
            >
              Leave whole day unknown
            </Button>
          </div>

          <div className="mt-4">
            <h3 className="font-bold">
              {format(parseISO(effectiveBackfillDate), "EEEE, d MMMM yyyy")}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {backfillEntries.length} scheduled{" "}
              {backfillEntries.length === 1 ? "class" : "classes"}
            </p>
          </div>

          {backfillEntries.length === 0 ? (
            <div className="border-border text-muted-foreground mt-4 rounded-xl border border-dashed p-6 text-center text-sm">
              No classes are scheduled on this date.
            </div>
          ) : (
            <div
              className="mt-4 grid gap-3 lg:grid-cols-2"
              data-testid="backfill-session-list"
            >
              {backfillEntries.map((entry) => (
                <HistoryEntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={setEditing}
                  onReset={setResetting}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <HistoryCalendar
          entries={entries}
          month={month}
          today={today}
          selectedStart={filters.startDate}
          selectedEnd={filters.endDate}
          minimumDate={semester.startDate}
          maximumDate={maximumBackfillDate}
          onMonthChange={setMonth}
          onSelectDate={(date) => {
            setFilters((current) => ({
              ...current,
              startDate: date,
              endDate: date,
            }));
            setMonth(parseISO(date));
            setBackfillDate(date);
          }}
        />
        <HistoryFilters
          values={filters}
          subjects={data.subjects.filter((subject) => subject.isEnabled)}
          onChange={(changes) =>
            setFilters((current) => ({ ...current, ...changes }))
          }
          onClear={() => setFilters(initialFilters)}
        />
      </div>

      <section aria-labelledby="history-list-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="history-list-title"
              className="font-display text-xl font-extrabold"
            >
              Chronological activity
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {visibleEntries.length}{" "}
              {visibleEntries.length === 1 ? "entry" : "entries"}
              {filters.startDate
                ? ` · ${format(parseISO(filters.startDate), "d MMM yyyy")}${filters.endDate && filters.endDate !== filters.startDate ? ` to ${format(parseISO(filters.endDate), "d MMM yyyy")}` : ""}`
                : ""}
            </p>
          </div>
        </div>

        {invalidRange ? (
          <Card className="text-danger p-5 text-sm font-semibold" role="alert">
            The start date must be on or before the end date.
          </Card>
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No matching history"
            description="Try a different date, subject, status, or search term."
          />
        ) : (
          <div
            className="grid gap-3 lg:grid-cols-2"
            data-testid="history-entry-list"
          >
            {visibleEntries.map((entry) => (
              <HistoryEntryCard
                key={entry.id}
                entry={entry}
                onEdit={setEditing}
                onReset={setResetting}
              />
            ))}
          </div>
        )}
      </section>

      <RecentActionsCard
        actions={data.recentActions}
        undoingId={undoingId}
        onUndo={undoAction}
      />

      <EditAttendanceDialog
        entry={editing}
        busy={editBusy}
        onClose={() => setEditing(undefined)}
        onSave={saveEdit}
      />
      <ConfirmActionDialog
        action={
          resetting
            ? {
                title: "Leave this attendance unknown?",
                description: `${resetting.subject.name} on ${format(parseISO(resetting.session.date), "d MMMM yyyy")} will be excluded from held and attended totals.`,
                confirmLabel: "Leave unknown",
                tone: "danger",
              }
            : undefined
        }
        busy={resetBusy}
        onClose={() => setResetting(undefined)}
        onConfirm={resetRecord}
      />
      <ConfirmActionDialog
        action={
          bulkStatus
            ? bulkConfirmation(
                bulkStatus,
                markableBackfillEntries.length,
                overwriteCount,
              )
            : undefined
        }
        busy={bulkBusy}
        onClose={() => setBulkStatus(undefined)}
        onConfirm={runBulkBackfill}
      />
    </div>
  );
}

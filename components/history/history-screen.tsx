"use client";

import { format, parseISO } from "date-fns";
import { CalendarRange, CheckCircle2, History, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmActionDialog } from "@/components/attendance/confirm-action-dialog";
import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import {
  ensureResolvedSessionExists,
  restoreResolvedSession,
} from "@/components/attendance/session-persistence";
import {
  isoDateInTimeZone,
  resolveSnapshotSessionsInRange,
} from "@/components/attendance/attendance-view-model";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { attendSafeRepository } from "@/db";
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
  const { data, loading, availability, error } = useAttendSafeData();
  const today = isoDateInTimeZone(new Date(), data?.activeProfile?.timezone);
  const [filters, setFilters] = useState<HistoryFilterValues>(initialFilters);
  const [month, setMonth] = useState(() => parseISO(today));
  const [editing, setEditing] = useState<HistoryEntry>();
  const [resetting, setResetting] = useState<HistoryEntry>();
  const [editBusy, setEditBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const sessions = useMemo(() => {
    const semester = data?.activeSemester;
    if (!data || !semester || today < semester.startDate) return [];
    return resolveSnapshotSessionsInRange(
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

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Opening attendance history" />;
  }
  if (availability !== "READY" || !data) {
    return (
      <AttendanceUnavailableState
        kind={availability === "READY" ? "ERROR" : availability}
        message={error?.message}
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

  const saveEdit = async (values: EditAttendanceValues) => {
    if (!editing) return;
    setEditBusy(true);
    try {
      await ensureResolvedSessionExists(editing.session);
      if (
        values.status !== "NOT_MARKED" &&
        (editing.session.status === "CANCELLED" ||
          editing.session.status === "NOT_CONDUCTED")
      ) {
        await restoreResolvedSession(
          editing.session,
          "Restored a class while correcting attendance",
        );
      }
      await attendSafeRepository.markAttendance(
        editing.session.id,
        values.status,
        values.notes.trim() || undefined,
      );
      setEditing(undefined);
      toast.success("Attendance correction saved");
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
      await ensureResolvedSessionExists(resetting.session);
      await attendSafeRepository.markAttendance(
        resetting.session.id,
        "NOT_MARKED",
      );
      setResetting(undefined);
      toast.success("Attendance record reset");
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
    <div className="grid gap-5" data-testid="history-page">
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

      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <HistoryCalendar
          entries={entries}
          month={month}
          today={today}
          selectedStart={filters.startDate}
          selectedEnd={filters.endDate}
          onMonthChange={setMonth}
          onSelectDate={(date) => {
            setFilters((current) => ({
              ...current,
              startDate: date,
              endDate: date,
            }));
            setMonth(parseISO(date));
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
                title: "Reset this attendance record?",
                description: `${resetting.subject.name} on ${format(parseISO(resetting.session.date), "d MMMM yyyy")} will return to not marked.`,
                confirmLabel: "Reset record",
                tone: "danger",
              }
            : undefined
        }
        busy={resetBusy}
        onClose={() => setResetting(undefined)}
        onConfirm={resetRecord}
      />
    </div>
  );
}

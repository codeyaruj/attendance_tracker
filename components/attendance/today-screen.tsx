"use client";

import {
  CalendarCheck2,
  CalendarOff,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ConfirmActionDialog,
  type ConfirmAction,
} from "@/components/attendance/confirm-action-dialog";
import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import { RecentActionsCard } from "@/components/attendance/recent-actions-card";
import {
  buildSubjectViews,
  currentAttendanceSessions,
  isoDateInTimeZone,
  resolveSnapshotSessionsForDate,
  viewForSubject,
} from "@/components/attendance/attendance-view-model";
import {
  applySessionDetailsOverride,
  ensureResolvedSessionExists,
  restoreResolvedSession,
} from "@/components/attendance/session-persistence";
import {
  SessionChangeDialog,
  type SessionChangeValues,
} from "@/components/attendance/session-change-dialog";
import {
  TodayDayActions,
  type TodayBulkAction,
} from "@/components/attendance/today-day-actions";
import { TodaySessionCard } from "@/components/attendance/today-session-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  attendSafeRepository,
  createEntityId,
  db,
  entityTimestamps,
  type MarkAttendanceStatus,
} from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import type { ResolvedSession } from "@/types/domain";

const confirmations: Record<TodayBulkAction, ConfirmAction> = {
  ALL_PRESENT: {
    title: "Mark every class present?",
    description: "All countable classes today will be marked present.",
    confirmLabel: "Mark all present",
  },
  ALL_ABSENT: {
    title: "Mark every class absent?",
    description: "This may lower several subject percentages.",
    confirmLabel: "Mark all absent",
    tone: "danger",
  },
  HOLIDAY: {
    title: "Mark today as a college holiday?",
    description:
      "Today’s scheduled classes will be excluded from attendance calculations.",
    confirmLabel: "Mark holiday",
  },
  RESET: {
    title: "Reset all attendance today?",
    description:
      "Attendance choices and one-off session states for today will be cleared.",
    confirmLabel: "Reset day",
    tone: "danger",
  },
};

export function TodayScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const timeZone = data?.activeProfile?.timezone;
  const today = isoDateInTimeZone(new Date(), timeZone);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<TodayBulkAction>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [undoingId, setUndoingId] = useState<string>();
  const [holidayUndo, setHolidayUndo] = useState<{
    id: string;
    date: string;
  }>();

  const sessions = useMemo(
    () => (data ? resolveSnapshotSessionsForDate(data, today) : []),
    [data, today],
  );
  const subjectViews = useMemo(
    () =>
      data
        ? buildSubjectViews(data, currentAttendanceSessions(data, today))
        : [],
    [data, today],
  );
  const subjectsById = useMemo(
    () => new Map(data?.subjects.map((subject) => [subject.id, subject]) ?? []),
    [data?.subjects],
  );
  const projectedRisk = sessions.reduce(
    (totals, session) => {
      if (
        session.status === "HOLIDAY" ||
        session.status === "CANCELLED" ||
        session.status === "NOT_CONDUCTED"
      ) {
        return totals;
      }
      const classification = viewForSubject(
        subjectViews,
        session.subjectId,
      )?.nextAbsenceClassification;
      if (classification === "SAFE") totals.safe += 1;
      else if (classification) totals.risky += 1;
      return totals;
    },
    { safe: 0, risky: 0 },
  );

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Preparing today’s classes" />;
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
        icon={CalendarCheck2}
        title="Set up your semester first"
        description="Add a profile and timetable to resolve today’s real classes."
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
  const activeSemester = data.activeSemester;

  const markSession = async (
    session: ResolvedSession,
    status: MarkAttendanceStatus,
  ) => {
    setPendingIds((current) => new Set(current).add(session.id));
    try {
      await ensureResolvedSessionExists(session);
      if (
        (status === "PRESENT" ||
          status === "ABSENT" ||
          status === "NOT_MARKED") &&
        (session.status === "CANCELLED" || session.status === "NOT_CONDUCTED")
      ) {
        await restoreResolvedSession(session);
      }
      await attendSafeRepository.markAttendance(session.id, status);
      toast.success(
        status === "NOT_MARKED"
          ? "Attendance reset"
          : `Marked ${status.toLowerCase().replaceAll("_", " ")}`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Attendance could not be saved.",
      );
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  };

  const runBulkAction = async () => {
    if (!confirming) return;
    setBulkBusy(true);
    try {
      const nonHoliday = sessions.filter(
        (session) => session.status !== "HOLIDAY",
      );
      if (confirming === "HOLIDAY") {
        const id = createEntityId();
        await attendSafeRepository.saveException({
          id,
          semesterId: activeSemester.id,
          type: "HOLIDAY",
          startDate: today,
          endDate: today,
          notes: "College holiday",
          ...entityTimestamps(),
        });
        setHolidayUndo({ id, date: today });
      } else {
        const targets =
          confirming === "RESET"
            ? nonHoliday
            : nonHoliday.filter(
                (session) =>
                  session.status !== "CANCELLED" &&
                  session.status !== "NOT_CONDUCTED",
              );
        for (const session of targets)
          await ensureResolvedSessionExists(session);
        if (confirming === "RESET") {
          const resettableExceptionIds = data.academicExceptions
            .filter(
              (exception) =>
                exception.startDate === today &&
                exception.endDate === today &&
                (exception.type === "HOLIDAY" ||
                  exception.type === "CANCELLED_DAY"),
            )
            .map((exception) => exception.id);
          if (resettableExceptionIds.length > 0) {
            await db.academicExceptions.bulkDelete(resettableExceptionIds);
            setHolidayUndo(undefined);
          }
          for (const session of targets) {
            if (
              session.status === "CANCELLED" ||
              session.status === "NOT_CONDUCTED"
            ) {
              await restoreResolvedSession(
                session,
                "Restored a class while resetting the day",
              );
            }
          }
        }
        const status =
          confirming === "ALL_PRESENT"
            ? "PRESENT"
            : confirming === "ALL_ABSENT"
              ? "ABSENT"
              : "NOT_MARKED";
        await attendSafeRepository.bulkMarkAttendance(
          targets.map((session) => ({ classSessionId: session.id, status })),
          confirming === "RESET"
            ? "Reset the day"
            : confirming === "ALL_PRESENT"
              ? "Marked the day present"
              : "Marked the day absent",
        );
      }
      toast.success(
        confirming === "HOLIDAY"
          ? "College holiday saved"
          : confirming === "RESET"
            ? "Day reset"
            : "Attendance updated",
      );
      setConfirming(undefined);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The day could not be updated.",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const saveSessionChange = async (values: SessionChangeValues) => {
    setChangeBusy(true);
    try {
      const source = sessions.find(
        (session) => session.id === values.sourceSessionId,
      );
      if (values.kind === "CANCELLATION") {
        if (!source) throw new Error("Choose the class to cancel.");
        await ensureResolvedSessionExists(source);
        await attendSafeRepository.markAttendance(
          source.id,
          "CANCELLED",
          values.notes || undefined,
        );
      } else if (values.kind === "OVERRIDE") {
        if (!source) throw new Error("Choose the class to update.");
        await ensureResolvedSessionExists(source);
        const persisted = await db.classSessions.get(source.id);
        if (!persisted)
          throw new Error("The selected class could not be saved.");
        await attendSafeRepository.upsertSession(
          applySessionDetailsOverride(persisted, values),
          "Changed room or faculty for one class",
        );
      } else {
        const subjectId =
          values.kind === "RESCHEDULE" ? source?.subjectId : values.subjectId;
        if (!subjectId) throw new Error("Choose a subject.");
        if (values.kind === "RESCHEDULE") {
          if (!source) throw new Error("Choose the class to reschedule.");
          await ensureResolvedSessionExists(source);
          await attendSafeRepository.markAttendance(
            source.id,
            "CANCELLED",
            "Moved to another date",
          );
        }
        const now = new Date().toISOString();
        await attendSafeRepository.upsertSession(
          {
            id: createEntityId(),
            semesterId: activeSemester.id,
            subjectId,
            date: values.date,
            startTime: values.startTime,
            endTime: values.endTime,
            status: values.kind === "EXTRA" ? "EXTRA" : "RESCHEDULED",
            source: values.kind === "EXTRA" ? "EXTRA" : "RESCHEDULED",
            faculty: values.faculty
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean),
            ...(values.room.trim() ? { room: values.room.trim() } : {}),
            ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
            createdAt: now,
            updatedAt: now,
          },
          values.kind === "EXTRA"
            ? "Added an extra class"
            : "Added a rescheduled class",
        );
      }
      setChangeOpen(false);
      toast.success(
        values.kind === "CANCELLATION"
          ? "Class cancelled"
          : values.kind === "OVERRIDE"
            ? "Class details updated"
            : values.kind === "EXTRA"
              ? "Extra class added"
              : "Class rescheduled",
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The timetable change could not be saved.",
      );
    } finally {
      setChangeBusy(false);
    }
  };

  const undoAction = async (action: { id: string }) => {
    setUndoingId(action.id);
    try {
      await attendSafeRepository.undo(action.id);
      toast.success("Change undone");
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

  const undoHoliday = async () => {
    if (!holidayUndo) return;
    await db.academicExceptions.delete(holidayUndo.id);
    setHolidayUndo(undefined);
    toast.success("Holiday undone");
  };

  const formattedDate = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${today}T12:00:00`));

  return (
    <div className="grid gap-5" data-testid="today-page">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="bg-primary text-primary-foreground overflow-hidden">
          <div className="p-5 sm:p-6">
            <p className="text-primary-foreground/75 text-xs font-bold tracking-[0.16em] uppercase">
              {formattedDate}
            </p>
            <h2 className="font-display mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              {sessions.length === 0
                ? "Your day is clear"
                : `${sessions.length} ${sessions.length === 1 ? "class" : "classes"} on your schedule`}
            </h2>
            <p className="text-primary-foreground/80 mt-2 max-w-2xl text-sm leading-6">
              Attendance changes stay on this device and immediately update
              every subject projection.
            </p>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <ShieldCheck
              className="text-safe-strong size-5"
              aria-hidden="true"
            />
            <p
              className="mt-3 text-2xl font-black"
              data-testid="today-safe-count"
            >
              {projectedRisk.safe}
            </p>
            <p className="text-muted-foreground text-xs font-semibold">
              Safe if missed
            </p>
          </Card>
          <Card className="p-4">
            <ShieldAlert
              className="text-warning-strong size-5"
              aria-hidden="true"
            />
            <p
              className="mt-3 text-2xl font-black"
              data-testid="today-risk-count"
            >
              {projectedRisk.risky}
            </p>
            <p className="text-muted-foreground text-xs font-semibold">
              Need attention
            </p>
          </Card>
        </div>
      </section>

      {holidayUndo ? (
        <div
          className="bg-info-soft text-info-strong flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm"
          role="status"
        >
          <span className="inline-flex items-center gap-2 font-semibold">
            <CalendarOff className="size-4" aria-hidden="true" />
            {holidayUndo.date} was marked as a college holiday.
          </span>
          <Button variant="ghost" size="sm" onClick={() => void undoHoliday()}>
            Undo
          </Button>
        </div>
      ) : null}

      <TodayDayActions
        disabled={sessions.length === 0 || bulkBusy}
        onRequest={setConfirming}
        onAddChange={() => setChangeOpen(true)}
      />

      <section aria-labelledby="today-classes-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2
              id="today-classes-title"
              className="font-display text-xl font-extrabold"
            >
              Today’s classes
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              In timetable order, with the impact of one absence.
            </p>
          </div>
        </div>
        {sessions.length === 0 ? (
          <EmptyState
            icon={CalendarCheck2}
            title="No classes today"
            description="Enjoy the breathing room, or add an extra class if your schedule changed."
            action={
              <Button onClick={() => setChangeOpen(true)}>
                Add extra class
              </Button>
            }
          />
        ) : (
          <div
            className="grid gap-3 xl:grid-cols-2"
            data-testid="today-session-list"
          >
            {sessions.map((session) => (
              <TodaySessionCard
                key={session.id}
                session={session}
                subject={subjectsById.get(session.subjectId)}
                subjectView={viewForSubject(subjectViews, session.subjectId)}
                pending={pendingIds.has(session.id)}
                onMark={markSession}
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

      <ConfirmActionDialog
        action={confirming ? confirmations[confirming] : undefined}
        busy={bulkBusy}
        onClose={() => setConfirming(undefined)}
        onConfirm={runBulkAction}
      />
      <SessionChangeDialog
        open={changeOpen}
        date={today}
        subjects={data.subjects.filter((subject) => subject.isEnabled)}
        sessions={sessions}
        busy={changeBusy}
        onClose={() => setChangeOpen(false)}
        onSubmit={saveSessionChange}
      />
    </div>
  );
}

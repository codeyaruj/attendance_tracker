"use client";

import {
  Ban,
  Check,
  CircleOff,
  Clock3,
  MapPin,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";

import {
  displayPercentage,
  formatClockTime,
  riskLabel,
  riskTone,
  type SubjectAttendanceView,
} from "@/components/attendance/attendance-view-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { MarkAttendanceStatus } from "@/db";
import type { ResolvedSession, Subject } from "@/types/domain";

const actions: Array<{
  value: MarkAttendanceStatus;
  label: string;
  icon: typeof Check;
}> = [
  { value: "PRESENT", label: "Present", icon: Check },
  { value: "ABSENT", label: "Absent", icon: X },
  { value: "CANCELLED", label: "Cancelled", icon: Ban },
  { value: "NOT_CONDUCTED", label: "Not held", icon: CircleOff },
  { value: "NOT_MARKED", label: "Not marked", icon: RotateCcw },
];

function selectedStatus(session: ResolvedSession): MarkAttendanceStatus {
  if (session.status === "CANCELLED") return "CANCELLED";
  if (session.status === "NOT_CONDUCTED") return "NOT_CONDUCTED";
  return session.attendanceStatus;
}

export function TodaySessionCard({
  session,
  subject,
  subjectView,
  pending,
  onMark,
}: {
  session: ResolvedSession;
  subject?: Subject;
  subjectView?: SubjectAttendanceView;
  pending: boolean;
  onMark: (
    session: ResolvedSession,
    status: MarkAttendanceStatus,
  ) => Promise<void>;
}) {
  const currentStatus = selectedStatus(session);
  const holiday = session.status === "HOLIDAY";
  const displayRisk = subjectView?.nextAbsenceClassification ?? "NO_DATA";

  return (
    <Card
      className="overflow-hidden"
      data-testid={`today-session-${session.id}`}
    >
      <div className="bg-primary/75 h-1" aria-hidden="true" />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-extrabold tracking-tight">
                {subject?.shortName ?? subject?.name ?? "Unknown subject"}
              </h3>
              {subject?.code ? <Badge>{subject.code}</Badge> : null}
              {session.source !== "TIMETABLE" ? (
                <Badge tone="info">
                  {session.source === "EXTRA" ? "Extra" : "Rescheduled"}
                </Badge>
              ) : null}
            </div>
            {subject?.shortName !== subject?.name && subject?.name ? (
              <p className="text-muted-foreground mt-0.5 truncate text-sm">
                {subject.name}
              </p>
            ) : null}
          </div>
          <Badge tone={riskTone(displayRisk)}>{riskLabel(displayRisk)}</Badge>
        </div>

        <div className="text-muted-foreground mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span className="text-foreground inline-flex items-center gap-1.5 font-semibold">
            <Clock3 className="text-primary size-4" aria-hidden="true" />
            {formatClockTime(session.startTime)}–
            {formatClockTime(session.endTime)}
          </span>
          {session.room ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden="true" />
              {session.room}
            </span>
          ) : null}
          {session.faculty.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-4" aria-hidden="true" />
              {session.faculty.join(", ")}
            </span>
          ) : null}
        </div>

        <div className="bg-background mt-4 rounded-2xl p-3.5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground text-[11px] font-bold tracking-[0.12em] uppercase">
                Current
              </p>
              <p className="mt-1 text-lg font-extrabold">
                {displayPercentage(
                  subjectView?.summary.percentageBasisPoints ?? null,
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] font-bold tracking-[0.12em] uppercase">
                If absent
              </p>
              <p className="mt-1 text-lg font-extrabold">
                {displayPercentage(subjectView?.nextAbsenceBasisPoints ?? null)}
              </p>
            </div>
          </div>
          {subjectView?.summary.percentageBasisPoints !== null ? (
            <Progress
              className="mt-3"
              value={(subjectView?.summary.percentageBasisPoints ?? 0) / 100}
              label={`${subject?.name ?? "Subject"} current attendance`}
              indicatorClassName={cn(
                displayRisk === "UNSAFE" && "bg-danger",
                (displayRisk === "CAUTION" || displayRisk === "BORDERLINE") &&
                  "bg-warning-strong",
              )}
            />
          ) : null}
        </div>

        {holiday ? (
          <div className="bg-info-soft text-info-strong mt-4 rounded-xl px-4 py-3 text-sm font-semibold">
            College holiday — this class does not count toward attendance.
          </div>
        ) : (
          <div
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"
            aria-label="Attendance choices"
          >
            {actions.map((action, index) => {
              const Icon = action.icon;
              const active = currentStatus === action.value;
              return (
                <Button
                  key={action.value}
                  variant={
                    active
                      ? action.value === "ABSENT"
                        ? "danger"
                        : "primary"
                      : "outline"
                  }
                  size="sm"
                  className={cn(
                    "min-h-11",
                    index >= 2 && "col-span-1",
                    index === 4 && "col-span-2 sm:col-span-1",
                  )}
                  disabled={pending}
                  aria-pressed={active}
                  onClick={() => void onMark(session, action.value)}
                  data-testid={`mark-${action.value.toLowerCase().replaceAll("_", "-")}-${session.id}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {pending && active ? "Saving…" : action.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

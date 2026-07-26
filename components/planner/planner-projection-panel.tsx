import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import {
  displayPercentage,
  formatClockTime,
  riskLabel,
  riskTone,
} from "@/components/attendance/attendance-view-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  CombinedSkipSimulation,
  FullDaySkipPlan,
  ProjectionClassification,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import type { ResolvedSession, Subject } from "@/types/domain";

import { formatPlannerDate } from "./planner-model";

function projectionMessage(classification: ProjectionClassification): string {
  switch (classification) {
    case "SAFE":
      return "The combined plan stays at or above every safety target.";
    case "CAUTION":
      return "The plan stays above the minimum, but crosses a personal safety target.";
    case "BORDERLINE":
      return "The plan lands directly on, or extremely close to, a minimum requirement.";
    case "UNSAFE":
      return "At least one subject would fall below its minimum requirement.";
    case "NO_DATA":
      return "Choose one or more upcoming classes to see a combined projection.";
  }
}

function displayBuffer(value: number): string {
  return Number.isFinite(value) ? String(value) : "unlimited";
}

function fullDayHeadline(plan: FullDaySkipPlan): {
  title: string;
  description: string;
  classification: ProjectionClassification;
} {
  switch (plan.outcome) {
    case "SAFE_TO_SKIP":
      return {
        title: "Safe to skip the whole day",
        description:
          "Every affected subject remains at or above its safety target.",
        classification: "SAFE",
      };
    case "SAFE_BELOW_SAFETY_TARGET":
      return {
        title: "Possible, with less safety buffer",
        description:
          "Every subject remains above its minimum, but at least one drops below its safety target.",
        classification: "CAUTION",
      };
    case "ATTEND_SPECIFIC_CLASSES":
      return {
        title: `Attend ${plan.mustAttendSessions.length} specific ${plan.mustAttendSessions.length === 1 ? "class" : "classes"}`,
        description: `You can still skip ${plan.sessionsSafeToSkip.length} while keeping every subject at or above minimum.`,
        classification: "UNSAFE",
      };
    case "CANNOT_REACH_MINIMUM":
      return {
        title: "Do not skip this entire day",
        description:
          "Even attending the recommended set cannot keep every affected subject above minimum.",
        classification: "UNSAFE",
      };
    case "NO_CLASSES":
      return {
        title: "No eligible classes",
        description: "This date has no upcoming, tracked classes to simulate.",
        classification: "NO_DATA",
      };
  }
}

function RecommendationList({
  sessions,
  subjectsById,
}: {
  sessions: readonly ResolvedSession[];
  subjectsById: ReadonlyMap<string, Subject>;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="border-warning-strong/25 bg-warning-soft mt-4 rounded-xl border p-4">
      <p className="text-warning-strong flex items-center gap-2 text-sm font-extrabold">
        <ShieldAlert className="size-4" aria-hidden="true" /> Classes to attend
      </p>
      <ul className="mt-3 grid gap-2 text-sm">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="bg-background/75 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
          >
            <span className="min-w-0 truncate font-semibold">
              {subjectsById.get(session.subjectId)?.name ?? "Unknown subject"}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatClockTime(session.startTime)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlannerProjectionPanel({
  simulation,
  fullDayPlan,
  persistenceSessions,
  subjectsById,
  onPlanAbsences,
  saving = false,
}: {
  simulation: CombinedSkipSimulation;
  fullDayPlan?: FullDaySkipPlan;
  persistenceSessions: readonly ResolvedSession[];
  subjectsById: ReadonlyMap<string, Subject>;
  onPlanAbsences: () => void;
  saving?: boolean;
}) {
  const displayedSimulation = fullDayPlan ?? simulation;
  const headline = fullDayPlan
    ? fullDayHeadline(fullDayPlan)
    : {
        title: riskLabel(displayedSimulation.overallClassification),
        description: projectionMessage(
          displayedSimulation.overallClassification,
        ),
        classification: displayedSimulation.overallClassification,
      };
  const hasSelection = displayedSimulation.selectedSessions.length > 0;
  const Icon =
    headline.classification === "SAFE"
      ? ShieldCheck
      : headline.classification === "UNSAFE"
        ? AlertTriangle
        : CheckCircle2;

  return (
    <Card
      className="overflow-hidden"
      aria-live="polite"
      data-testid="planner-projection"
    >
      <div
        className={cn(
          "h-1",
          headline.classification === "SAFE" && "bg-safe-strong",
          (headline.classification === "CAUTION" ||
            headline.classification === "BORDERLINE") &&
            "bg-warning-strong",
          headline.classification === "UNSAFE" && "bg-danger",
          headline.classification === "NO_DATA" && "bg-border",
        )}
        aria-hidden="true"
      />
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              headline.classification === "SAFE" &&
                "bg-safe-soft text-safe-strong",
              (headline.classification === "CAUTION" ||
                headline.classification === "BORDERLINE") &&
                "bg-warning-soft text-warning-strong",
              headline.classification === "UNSAFE" &&
                "bg-danger-soft text-danger",
              headline.classification === "NO_DATA" &&
                "bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-extrabold tracking-tight">
                {headline.title}
              </h2>
              <Badge tone={riskTone(headline.classification)}>
                {riskLabel(headline.classification)}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {headline.description}
            </p>
          </div>
        </div>

        {fullDayPlan ? (
          <RecommendationList
            sessions={fullDayPlan.mustAttendSessions}
            subjectsById={subjectsById}
          />
        ) : null}

        {displayedSimulation.subjectProjections.length > 0 ? (
          <div className="border-border mt-5 overflow-hidden rounded-xl border">
            <div className="bg-secondary text-muted-foreground hidden grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 px-4 py-2.5 text-xs font-bold tracking-wide uppercase sm:grid">
              <span>Subject</span>
              <span>Current</span>
              <span>After plan</span>
              <span>Result</span>
            </div>
            <div className="divide-border divide-y">
              {displayedSimulation.subjectProjections.map((projection) => {
                const subject = subjectsById.get(projection.subjectId);
                return (
                  <div
                    key={projection.subjectId}
                    className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {subject?.name ?? "Unknown subject"}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {projection.missedSessions} planned{" "}
                        {projection.missedSessions === 1
                          ? "absence"
                          : "absences"}{" "}
                        · {displayBuffer(projection.remainingSkipBuffer)} left
                        afterward
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm sm:contents">
                      <span className="text-muted-foreground font-semibold">
                        {displayPercentage(
                          projection.currentPercentageBasisPoints,
                        )}
                      </span>
                      <ArrowRight
                        className="text-muted-foreground size-3.5 sm:hidden"
                        aria-hidden="true"
                      />
                      <span className="font-extrabold">
                        {displayPercentage(
                          projection.projectedPercentageBasisPoints,
                        )}
                      </span>
                    </div>
                    <Badge
                      tone={riskTone(projection.classification)}
                      className="w-fit"
                    >
                      {riskLabel(projection.classification)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="border-border mt-5 border-t pt-5">
          {hasSelection ? (
            <p className="text-muted-foreground mb-3 text-xs leading-5">
              This projection assumes future timetable sessions and exceptions
              remain unchanged. Nothing is saved until you confirm.
            </p>
          ) : null}
          <Button
            className="w-full sm:w-auto"
            variant={simulation.meetsMinimum ? "primary" : "danger"}
            disabled={persistenceSessions.length === 0 || saving}
            onClick={onPlanAbsences}
            data-testid="plan-absences"
          >
            {saving
              ? "Saving plan…"
              : persistenceSessions.length > 0
                ? `Plan ${persistenceSessions.length} ${persistenceSessions.length === 1 ? "absence" : "absences"}`
                : "Choose classes to plan"}
          </Button>
          {persistenceSessions.length > 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">
              First planned class:{" "}
              {formatPlannerDate(persistenceSessions[0].date)} at{" "}
              {formatClockTime(persistenceSessions[0].startTime)}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

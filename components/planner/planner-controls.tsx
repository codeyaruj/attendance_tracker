import { Check, Filter, ShieldCheck, Sparkles } from "lucide-react";

import {
  displayPercentage,
  formatClockTime,
  type SubjectAttendanceView,
} from "@/components/attendance/attendance-view-model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type ResolvedSession,
  type Subject,
} from "@/types/domain";
import type { RankedSafeSession } from "@/lib/attendance";
import { cn } from "@/lib/utils";

import {
  formatPlannerDate,
  type PlannerMode,
  type SafestDayRecommendation,
} from "./planner-model";
import { PlannerSessionList } from "./planner-session-list";

const weekdayLabels: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

function DateRangeFields({
  startDate,
  endDate,
  minimumDate,
  maximumDate,
  onStartDateChange,
  onEndDateChange,
}: {
  startDate: string;
  endDate: string;
  minimumDate: string;
  maximumDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Start date">
        <Input
          type="date"
          value={startDate}
          min={minimumDate}
          max={maximumDate}
          onChange={(event) => onStartDateChange(event.target.value)}
        />
      </Field>
      <Field
        label="End date"
        error={
          endDate < startDate
            ? "End date must be on or after start date."
            : undefined
        }
      >
        <Input
          type="date"
          value={endDate}
          min={startDate || minimumDate}
          max={maximumDate}
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </Field>
    </div>
  );
}

function SubjectToggles({
  subjects,
  excludedIds,
  onToggle,
  label,
}: {
  subjects: readonly Subject[];
  excludedIds: ReadonlySet<string>;
  onToggle: (subjectId: string) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {subjects.map((subject) => {
          const included = !excludedIds.has(subject.id);
          return (
            <button
              key={subject.id}
              type="button"
              aria-pressed={included}
              onClick={() => onToggle(subject.id)}
              className={cn(
                "focus-visible:ring-primary inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none",
                included
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-muted-foreground",
              )}
            >
              {included ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : null}
              {subject.shortName}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SafestWeekPicker({
  ranking,
  selectedIds,
  subjectsById,
  onToggle,
}: {
  ranking: readonly RankedSafeSession[];
  selectedIds: ReadonlySet<string>;
  subjectsById: ReadonlyMap<string, Subject>;
  onToggle: (sessionId: string) => void;
}) {
  if (ranking.length === 0) {
    return (
      <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm">
        No class passes the active filters without falling below minimum.
      </p>
    );
  }
  return (
    <div className="grid max-h-[31rem] gap-2 overflow-y-auto pr-1">
      {ranking.map((entry) => {
        const subject = subjectsById.get(entry.session.subjectId);
        const selected = selectedIds.has(entry.session.id);
        return (
          <label
            key={entry.session.id}
            className={cn(
              "focus-within:ring-primary grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3.5 transition-colors focus-within:ring-2",
              selected
                ? "border-primary bg-primary-soft"
                : "border-border bg-surface",
            )}
          >
            <span className="bg-safe-soft text-safe-strong grid size-8 place-items-center rounded-lg text-xs font-black">
              #{entry.rank}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">
                {subject?.name ?? "Unknown subject"}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {formatPlannerDate(entry.session.date)} ·{" "}
                {formatClockTime(entry.session.startTime)} · after skip{" "}
                {displayPercentage(
                  entry.projection.projectedPercentageBasisPoints,
                )}
              </span>
            </span>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(entry.session.id)}
              className="size-4 accent-[var(--color-primary)]"
              aria-label={`Plan ranked class ${entry.rank}: ${subject?.name ?? "Unknown subject"}`}
            />
          </label>
        );
      })}
    </div>
  );
}

export interface PlannerControlsProps {
  mode: PlannerMode;
  sessions: readonly ResolvedSession[];
  subjects: readonly Subject[];
  subjectsById: ReadonlyMap<string, Subject>;
  minimumDate: string;
  maximumDate: string;
  singleSessionId: string;
  onSingleSessionChange: (sessionId: string) => void;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  selectedSessionIds: ReadonlySet<string>;
  onSelectedSessionToggle: (sessionId: string) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  weekday: DayOfWeek;
  onWeekdayChange: (weekday: DayOfWeek) => void;
  recurringExcludedSubjectIds: ReadonlySet<string>;
  onRecurringSubjectToggle: (subjectId: string) => void;
  recurringCandidateSessions: readonly ResolvedSession[];
  recurringIncludedSessionIds: ReadonlySet<string>;
  onRecurringSessionToggle: (sessionId: string) => void;
  safestRanking: readonly RankedSafeSession[];
  safestSelectedIds: ReadonlySet<string>;
  onSafestSessionToggle: (sessionId: string) => void;
  safestDay?: SafestDayRecommendation;
  onUseSafestDay: (date: string) => void;
  theoryOnly: boolean;
  excludeLabs: boolean;
  excludeZeroCredit: boolean;
  onTheoryOnlyChange: (value: boolean) => void;
  onExcludeLabsChange: (value: boolean) => void;
  onExcludeZeroCreditChange: (value: boolean) => void;
  safestDays: ReadonlySet<DayOfWeek>;
  onSafestDayToggle: (day: DayOfWeek) => void;
  safestExcludedSubjectIds: ReadonlySet<string>;
  onSafestSubjectToggle: (subjectId: string) => void;
  subjectViews: readonly SubjectAttendanceView[];
}

export function PlannerControls(props: PlannerControlsProps) {
  const { mode, sessions, subjects, subjectsById, minimumDate, maximumDate } =
    props;

  switch (mode) {
    case "SINGLE":
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Check one upcoming class
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              See the exact subject percentage and remaining buffer after one
              absence.
            </p>
          </div>
          <Field label="Upcoming class">
            <Select
              value={props.singleSessionId}
              onChange={(event) =>
                props.onSingleSessionChange(event.target.value)
              }
              disabled={sessions.length === 0}
            >
              {sessions.length === 0 ? (
                <option value="">No upcoming classes</option>
              ) : null}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatPlannerDate(session.date)} ·{" "}
                  {formatClockTime(session.startTime)} ·{" "}
                  {subjectsById.get(session.subjectId)?.shortName ?? "Class"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      );
    case "DAY":
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Can I skip a whole day?
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              If the complete day is unsafe, AttendSafe finds the smallest
              chronological set to attend.
            </p>
          </div>
          <Field label="Date">
            <Input
              type="date"
              value={props.selectedDate}
              min={minimumDate}
              max={maximumDate}
              onChange={(event) =>
                props.onSelectedDateChange(event.target.value)
              }
            />
          </Field>
        </div>
      );
    case "SELECTED":
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Combine selected classes
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Every checked absence is evaluated together, including repeats of
              the same subject.
            </p>
          </div>
          <PlannerSessionList
            sessions={sessions}
            subjectsById={subjectsById}
            selectedIds={props.selectedSessionIds}
            onToggle={props.onSelectedSessionToggle}
          />
        </div>
      );
    case "RANGE":
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Project a date range
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              All actual tracked sessions in the period are combined into one
              plan.
            </p>
          </div>
          <DateRangeFields
            startDate={props.startDate}
            endDate={props.endDate}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onStartDateChange={props.onStartDateChange}
            onEndDateChange={props.onEndDateChange}
          />
        </div>
      );
    case "WEEKDAY":
      return (
        <div className="grid gap-5">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Skip a recurring weekday
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Test every occurrence of one weekday while excluding any subjects
              you still plan to attend.
            </p>
          </div>
          <DateRangeFields
            startDate={props.startDate}
            endDate={props.endDate}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onStartDateChange={props.onStartDateChange}
            onEndDateChange={props.onEndDateChange}
          />
          <Field label="Weekday">
            <Select
              value={props.weekday}
              onChange={(event) =>
                props.onWeekdayChange(event.target.value as DayOfWeek)
              }
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>
                  {weekdayLabels[day]}
                </option>
              ))}
            </Select>
          </Field>
          <SubjectToggles
            subjects={subjects}
            excludedIds={props.recurringExcludedSubjectIds}
            onToggle={props.onRecurringSubjectToggle}
            label="Classes to include"
          />
          <fieldset>
            <legend className="text-sm font-semibold">
              Individual occurrences
            </legend>
            <p className="text-muted-foreground mt-1 text-xs">
              Uncheck a specific occurrence to keep it out of this recurring
              plan.
            </p>
            <div className="mt-2">
              <PlannerSessionList
                sessions={props.recurringCandidateSessions}
                subjectsById={subjectsById}
                selectedIds={props.recurringIncludedSessionIds}
                onToggle={props.onRecurringSessionToggle}
                emptyMessage="No classes match this weekday and subject selection."
              />
            </div>
          </fieldset>
        </div>
      );
    case "SAFEST":
      return (
        <div className="grid gap-5">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Safest options this week
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Classes are ranked individually; checked classes are still
              re-evaluated together before saving.
            </p>
          </div>
          {props.safestDay ? (
            <Card className="border-safe-strong/25 bg-safe-soft/50 p-4">
              <div className="flex items-start gap-3">
                <span className="bg-safe-soft text-safe-strong grid size-10 shrink-0 place-items-center rounded-xl">
                  <Sparkles className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-safe-strong text-xs font-bold tracking-[0.14em] uppercase">
                    Safest day in this window
                  </p>
                  <p className="font-display mt-1 text-lg font-extrabold">
                    {formatPlannerDate(props.safestDay.date)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {props.safestDay.safeToSkipSessions} of{" "}
                    {props.safestDay.scheduledSessions} classes can be skipped
                    while preserving minimums.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => props.onUseSafestDay(props.safestDay!.date)}
                >
                  Open day
                </Button>
              </div>
            </Card>
          ) : null}
          <fieldset>
            <legend className="flex items-center gap-2 text-sm font-semibold">
              <Filter className="size-4" aria-hidden="true" /> Filters
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                ["Theory only", props.theoryOnly, props.onTheoryOnlyChange],
                ["Exclude labs", props.excludeLabs, props.onExcludeLabsChange],
                [
                  "Exclude zero-credit",
                  props.excludeZeroCredit,
                  props.onExcludeZeroCreditChange,
                ],
              ].map(([label, active, onChange]) => (
                <button
                  key={String(label)}
                  type="button"
                  aria-pressed={Boolean(active)}
                  onClick={() =>
                    (onChange as (value: boolean) => void)(!active)
                  }
                  className={cn(
                    "focus-visible:ring-primary min-h-9 rounded-full border px-3 text-xs font-bold focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border bg-surface text-muted-foreground",
                  )}
                >
                  {String(label)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS_OF_WEEK.slice(0, 5).map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={props.safestDays.has(day)}
                  onClick={() => props.onSafestDayToggle(day)}
                  className={cn(
                    "focus-visible:ring-primary min-h-9 rounded-full border px-3 text-xs font-bold focus-visible:ring-2 focus-visible:outline-none",
                    props.safestDays.has(day)
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border bg-surface text-muted-foreground",
                  )}
                >
                  {weekdayLabels[day].slice(0, 3)}
                </button>
              ))}
            </div>
          </fieldset>
          <SubjectToggles
            subjects={subjects}
            excludedIds={props.safestExcludedSubjectIds}
            onToggle={props.onSafestSubjectToggle}
            label="Subjects"
          />
          <SafestWeekPicker
            ranking={props.safestRanking}
            selectedIds={props.safestSelectedIds}
            subjectsById={subjectsById}
            onToggle={props.onSafestSessionToggle}
          />
        </div>
      );
    case "BUFFERS":
      return (
        <div className="grid gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">
              Maximum skips by subject
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              These are current buffers at each subject’s minimum requirement,
              before future attendance is added.
            </p>
          </div>
          <div className="border-border overflow-hidden rounded-xl border">
            <div className="divide-border divide-y">
              {props.subjectViews.map((view) => (
                <div
                  key={view.subject.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {view.subject.name}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {displayPercentage(view.summary.percentageBasisPoints)}{" "}
                      now · minimum{" "}
                      {displayPercentage(view.summary.minimumBasisPoints)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-primary text-xl font-black">
                      {Number.isFinite(view.skippable) ? view.skippable : "∞"}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      maximum skips
                    </p>
                  </div>
                  <div className="bg-secondary col-span-2 rounded-lg px-3 py-2 text-xs sm:col-span-1">
                    {view.recovery > 0
                      ? `${Number.isFinite(view.recovery) ? view.recovery : "Not reachable"} to recover`
                      : "No recovery needed"}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-info-soft text-info-strong flex gap-2 rounded-xl p-3.5 text-xs leading-5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Buffers change after every held class. Use another planner mode
            before deciding which actual dates to miss.
          </div>
        </div>
      );
  }
}

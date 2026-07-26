import {
  ArrowDownRight,
  BookOpenCheck,
  Shield,
  TrendingUp,
} from "lucide-react";

import {
  displayPercentage,
  riskLabel,
  riskTone,
  type SubjectAttendanceView,
} from "@/components/attendance/attendance-view-model";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function displayCount(value: number, infiniteLabel: string): string {
  return Number.isFinite(value) ? String(value) : infiniteLabel;
}

export function SubjectAttendanceCard({
  view,
}: {
  view: SubjectAttendanceView;
}) {
  const { subject, summary, classification } = view;
  return (
    <Card
      className="overflow-hidden"
      data-testid={`subject-card-${subject.id}`}
    >
      <div
        className={cn(
          "h-1",
          classification === "SAFE" && "bg-safe-strong",
          (classification === "CAUTION" || classification === "BORDERLINE") &&
            "bg-warning-strong",
          classification === "UNSAFE" && "bg-danger",
          classification === "NO_DATA" && "bg-border",
        )}
        aria-hidden="true"
      />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-extrabold tracking-tight">
                {subject.name}
              </h3>
              {subject.code ? <Badge>{subject.code}</Badge> : null}
            </div>
            <p className="text-muted-foreground mt-1 text-xs font-semibold tracking-[0.12em] uppercase">
              {subject.classType.toLowerCase()} · {subject.credits}{" "}
              {subject.credits === 1 ? "credit" : "credits"}
            </p>
          </div>
          <Badge tone={riskTone(classification)}>
            {riskLabel(classification)}
          </Badge>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p
              className="text-3xl font-black tracking-tight"
              data-testid={`subject-percentage-${subject.id}`}
            >
              {displayPercentage(summary.percentageBasisPoints)}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              <span className="text-foreground font-bold">
                {summary.attended}
              </span>{" "}
              attended of{" "}
              <span className="text-foreground font-bold">{summary.held}</span>{" "}
              held
            </p>
          </div>
          <BookOpenCheck
            className="text-primary/70 size-8"
            aria-hidden="true"
          />
        </div>
        <Progress
          className="mt-4 h-2.5"
          value={(summary.percentageBasisPoints ?? 0) / 100}
          label={`${subject.name} attendance`}
          indicatorClassName={cn(
            classification === "UNSAFE" && "bg-danger",
            (classification === "CAUTION" || classification === "BORDERLINE") &&
              "bg-warning-strong",
            classification === "NO_DATA" && "bg-muted-foreground",
          )}
        />

        <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
          <div className="bg-background rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">Minimum</dt>
            <dd className="mt-1 font-extrabold">
              {displayPercentage(summary.minimumBasisPoints)}
            </dd>
          </div>
          <div className="bg-background rounded-xl p-3">
            <dt className="text-muted-foreground text-xs">Safety target</dt>
            <dd className="mt-1 font-extrabold">
              {displayPercentage(summary.safetyBasisPoints)}
            </dd>
          </div>
          <div className="bg-background rounded-xl p-3">
            <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Shield className="size-3.5" aria-hidden="true" /> Skippable now
            </dt>
            <dd className="mt-1 font-extrabold">
              {displayCount(view.skippable, "Unlimited")}
            </dd>
          </div>
          <div className="bg-background rounded-xl p-3">
            <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <TrendingUp className="size-3.5" aria-hidden="true" /> Needed to
              recover
            </dt>
            <dd className="mt-1 font-extrabold">
              {displayCount(view.recovery, "Not reachable")}
            </dd>
          </div>
        </dl>

        <div className="border-border mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <ArrowDownRight className="size-4" aria-hidden="true" /> After next
            absence
          </span>
          <span className="font-extrabold">
            {displayPercentage(view.nextAbsenceBasisPoints)}
          </span>
        </div>
      </div>
    </Card>
  );
}

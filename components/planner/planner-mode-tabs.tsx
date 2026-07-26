import {
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  CheckSquare2,
  ListChecks,
  Repeat2,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { PlannerMode } from "./planner-model";

const modes: Array<{
  id: PlannerMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof CalendarDays;
}> = [
  {
    id: "SINGLE",
    label: "One class",
    shortLabel: "One",
    description: "Check one upcoming class",
    icon: CalendarSearch,
  },
  {
    id: "DAY",
    label: "Whole day",
    shortLabel: "Day",
    description: "Test every class on a date",
    icon: CalendarDays,
  },
  {
    id: "SELECTED",
    label: "Selected classes",
    shortLabel: "Select",
    description: "Combine a custom set",
    icon: CheckSquare2,
  },
  {
    id: "RANGE",
    label: "Date range",
    shortLabel: "Range",
    description: "Project consecutive dates",
    icon: CalendarRange,
  },
  {
    id: "WEEKDAY",
    label: "Recurring weekday",
    shortLabel: "Repeat",
    description: "Test every chosen weekday",
    icon: Repeat2,
  },
  {
    id: "SAFEST",
    label: "Safest this week",
    shortLabel: "Safest",
    description: "Rank the strongest options",
    icon: ShieldCheck,
  },
  {
    id: "BUFFERS",
    label: "Subject limits",
    shortLabel: "Limits",
    description: "Maximum skips per subject",
    icon: ListChecks,
  },
];

export function PlannerModeTabs({
  value,
  onChange,
}: {
  value: PlannerMode;
  onChange: (mode: PlannerMode) => void;
}) {
  return (
    <div
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] lg:grid lg:grid-cols-7 lg:overflow-visible [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Skip planning mode"
    >
      {modes.map((mode) => {
        const active = value === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls="planner-mode-panel"
            title={mode.description}
            onClick={() => onChange(mode.id)}
            className={cn(
              "focus-visible:ring-primary flex min-h-16 min-w-[92px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border px-3 text-center text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none lg:min-w-0",
              active
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            <Icon className="size-4.5" aria-hidden="true" />
            <span className="lg:hidden">{mode.shortLabel}</span>
            <span className="hidden lg:block">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

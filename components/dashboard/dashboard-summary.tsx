import {
  BookOpenCheck,
  CalendarClock,
  CalendarHeart,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Card } from "@/components/ui/card";

const items = [
  {
    key: "tracked",
    label: "Tracked subjects",
    icon: BookOpenCheck,
    tone: "text-primary",
  },
  {
    key: "minimum",
    label: "Below minimum",
    icon: TriangleAlert,
    tone: "text-danger",
  },
  {
    key: "safety",
    label: "Below safety target",
    icon: ShieldAlert,
    tone: "text-warning-strong",
  },
  {
    key: "safest",
    label: "Safest day this week",
    icon: CalendarHeart,
    tone: "text-safe-strong",
  },
  {
    key: "upcoming",
    label: "Upcoming today",
    icon: CalendarClock,
    tone: "text-info-strong",
  },
] as const;

export function DashboardSummary({
  values,
}: {
  values: Record<(typeof items)[number]["key"], string | number>;
}) {
  return (
    <section
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      aria-label="Attendance summary"
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.key}
            className={index === 2 ? "col-span-2 p-4 lg:col-span-1" : "p-4"}
            data-testid={`summary-${item.key}`}
          >
            <Icon className={`size-5 ${item.tone}`} aria-hidden="true" />
            <p className="mt-4 truncate text-2xl font-black tracking-tight">
              {values[item.key]}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-4 font-semibold">
              {item.label}
            </p>
          </Card>
        );
      })}
    </section>
  );
}

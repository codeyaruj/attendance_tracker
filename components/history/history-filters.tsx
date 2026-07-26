"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-controls";
import type { Subject } from "@/types/domain";

import { historyStatusLabel, type HistoryStatus } from "./history-view-model";

export interface HistoryFilterValues {
  query: string;
  subjectId: string;
  status: "ALL" | HistoryStatus;
  startDate: string;
  endDate: string;
}

const statuses: HistoryStatus[] = [
  "PRESENT",
  "ABSENT",
  "EXEMPT",
  "NOT_MARKED",
  "CANCELLED",
  "NOT_CONDUCTED",
  "HOLIDAY",
  "EXTRA",
  "RESCHEDULED",
];

export function HistoryFilters({
  values,
  subjects,
  onChange,
  onClear,
}: {
  values: HistoryFilterValues;
  subjects: readonly Subject[];
  onChange: (changes: Partial<HistoryFilterValues>) => void;
  onClear: () => void;
}) {
  const filtered =
    values.query !== "" ||
    values.subjectId !== "ALL" ||
    values.status !== "ALL" ||
    values.startDate !== "" ||
    values.endDate !== "";

  return (
    <Card className="p-4 sm:p-5" data-testid="history-filters">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display inline-flex items-center gap-2 text-lg font-extrabold">
          <SlidersHorizontal
            className="text-primary size-5"
            aria-hidden="true"
          />{" "}
          Filters
        </h2>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-testid="clear-history-filters"
          >
            <X className="size-4" aria-hidden="true" /> Clear
          </Button>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="relative block sm:col-span-2 xl:col-span-1">
          <span className="sr-only">Search history</span>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            className="pl-10"
            type="search"
            placeholder="Search subject, room…"
            value={values.query}
            onChange={(event) => onChange({ query: event.target.value })}
            data-testid="history-search"
          />
        </label>
        <Field label="Subject">
          <Select
            value={values.subjectId}
            onChange={(event) => onChange({ subjectId: event.target.value })}
            data-testid="history-subject-filter"
          >
            <option value="ALL">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={values.status}
            onChange={(event) =>
              onChange({
                status: event.target.value as HistoryFilterValues["status"],
              })
            }
            data-testid="history-status-filter"
          >
            <option value="ALL">All activity</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {historyStatusLabel(status)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input
            type="date"
            value={values.startDate}
            onChange={(event) => onChange({ startDate: event.target.value })}
            data-testid="history-start-date"
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={values.endDate}
            onChange={(event) => onChange({ endDate: event.target.value })}
            data-testid="history-end-date"
          />
        </Field>
      </div>
    </Card>
  );
}

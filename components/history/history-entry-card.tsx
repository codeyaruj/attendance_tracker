"use client";

import { Clock3, MapPin, Pencil, RotateCcw } from "lucide-react";
import { format, parseISO } from "date-fns";

import {
  displayPercentage,
  formatClockTime,
} from "@/components/attendance/attendance-view-model";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import {
  historyStatusLabel,
  type HistoryEntry,
  type HistoryStatus,
} from "./history-view-model";

function statusTone(status: HistoryStatus): BadgeTone {
  switch (status) {
    case "PRESENT":
      return "safe";
    case "ABSENT":
      return "danger";
    case "CANCELLED":
    case "NOT_CONDUCTED":
    case "HOLIDAY":
    case "NOT_MARKED":
      return "neutral";
    case "EXEMPT":
    case "EXTRA":
    case "RESCHEDULED":
      return "info";
  }
}

function auditMessage(entry: HistoryEntry): string {
  if (
    entry.status === "CANCELLED" ||
    entry.status === "HOLIDAY" ||
    entry.status === "NOT_CONDUCTED"
  ) {
    return "Excluded from held-class totals.";
  }
  if (entry.beforeBasisPoints === entry.afterBasisPoints) {
    return `Attendance stayed at ${displayPercentage(entry.afterBasisPoints)}.`;
  }
  return `Attendance changed from ${displayPercentage(entry.beforeBasisPoints)} to ${displayPercentage(entry.afterBasisPoints)}.`;
}

export function HistoryEntryCard({
  entry,
  onEdit,
  onReset,
}: {
  entry: HistoryEntry;
  onEdit: (entry: HistoryEntry) => void;
  onReset: (entry: HistoryEntry) => void;
}) {
  const notes = entry.record?.notes ?? entry.session.notes;
  return (
    <Card className="p-4 sm:p-5" data-testid={`history-entry-${entry.id}`}>
      <div className="flex items-start gap-4">
        <div className="bg-background w-12 shrink-0 rounded-xl px-2 py-2 text-center">
          <p className="text-muted-foreground text-[10px] font-bold uppercase">
            {format(parseISO(entry.session.date), "MMM")}
          </p>
          <p className="text-xl leading-6 font-black">
            {format(parseISO(entry.session.date), "d")}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-extrabold sm:text-lg">
                  {entry.subject.name}
                </h3>
                {entry.subject.code ? (
                  <Badge>{entry.subject.code}</Badge>
                ) : null}
              </div>
              <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  {formatClockTime(entry.session.startTime)}
                </span>
                {entry.session.room ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {entry.session.room}
                  </span>
                ) : null}
              </div>
            </div>
            <Badge tone={statusTone(entry.status)}>
              {historyStatusLabel(entry.status)}
            </Badge>
          </div>

          <p
            className="bg-background mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold"
            data-testid={`history-delta-${entry.id}`}
          >
            {auditMessage(entry)}
          </p>
          {notes ? (
            <p className="text-muted-foreground mt-2 text-sm italic">
              “{notes}”
            </p>
          ) : null}

          {entry.record ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(entry)}
                data-testid={`edit-history-${entry.id}`}
              >
                <Pencil className="size-4" aria-hidden="true" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReset(entry)}
                data-testid={`reset-history-${entry.id}`}
              >
                <RotateCcw className="size-4" aria-hidden="true" /> Reset
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

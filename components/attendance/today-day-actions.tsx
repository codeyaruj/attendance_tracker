"use client";

import {
  CalendarOff,
  CheckCheck,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type TodayBulkAction =
  "ALL_PRESENT" | "ALL_ABSENT" | "HOLIDAY" | "RESET";

export function TodayDayActions({
  disabled,
  onRequest,
  onAddChange,
}: {
  disabled: boolean;
  onRequest: (action: TodayBulkAction) => void;
  onAddChange: () => void;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold">Day actions</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Update several classes with one confirmation.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onAddChange}
          data-testid="add-session-change"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add change
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onRequest("ALL_PRESENT")}
        >
          <CheckCheck className="size-4" aria-hidden="true" />
          All present
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onRequest("ALL_ABSENT")}
        >
          <XCircle className="size-4" aria-hidden="true" />
          All absent
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onRequest("HOLIDAY")}
        >
          <CalendarOff className="size-4" aria-hidden="true" />
          Holiday
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onRequest("RESET")}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset day
        </Button>
      </div>
    </Card>
  );
}

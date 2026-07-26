"use client";

import { CalendarCheck2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ResolvedSession } from "@/types/domain";

import { formatPlannerDate } from "./planner-model";

export function PlannerConfirmDialog({
  open,
  sessions,
  busy,
  unsafe,
  onClose,
  onConfirm,
}: {
  open: boolean;
  sessions: readonly ResolvedSession[];
  busy: boolean;
  unsafe: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const firstDate = sessions[0]?.date;
  const lastDate = sessions.at(-1)?.date;
  const dateDescription = firstDate
    ? firstDate === lastDate
      ? formatPlannerDate(firstDate)
      : `${formatPlannerDate(firstDate)} – ${formatPlannerDate(lastDate ?? firstDate)}`
    : "No dates selected";

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Plan ${sessions.length} ${sessions.length === 1 ? "absence" : "absences"}?`}
      description={`${dateDescription}. This is the only step that writes the plan to your local attendance data.`}
    >
      <div
        className={
          unsafe
            ? "bg-danger-soft text-danger-strong rounded-2xl p-4 text-sm"
            : "bg-primary-soft text-primary rounded-2xl p-4 text-sm"
        }
      >
        <div className="flex gap-3">
          {unsafe ? (
            <CalendarCheck2
              className="mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <LockKeyhole
              className="mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
          )}
          <p>
            {unsafe
              ? "This selection is below at least one target. Confirm only if you still intend to miss these classes."
              : "Planned classes will be marked absent when their dates enter attendance history. You can edit or undo them later."}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Keep simulating
        </Button>
        <Button
          variant={unsafe ? "danger" : "primary"}
          onClick={() => void onConfirm()}
          disabled={busy || sessions.length === 0}
          data-testid="confirm-planned-absences"
        >
          {busy ? "Saving…" : "Confirm planned absences"}
        </Button>
      </div>
    </Dialog>
  );
}

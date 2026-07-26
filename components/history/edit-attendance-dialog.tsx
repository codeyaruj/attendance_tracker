"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import type { AttendanceStatus } from "@/types/domain";

import type { HistoryEntry } from "./history-view-model";

export interface EditAttendanceValues {
  status: AttendanceStatus;
  notes: string;
}

export function EditAttendanceDialog({
  entry,
  busy,
  onClose,
  onSave,
}: {
  entry?: HistoryEntry;
  busy: boolean;
  onClose: () => void;
  onSave: (values: EditAttendanceValues) => Promise<void>;
}) {
  const { register, handleSubmit, reset } = useForm<EditAttendanceValues>({
    defaultValues: { status: "NOT_MARKED", notes: "" },
  });

  useEffect(() => {
    if (!entry) return;
    reset({
      status: entry.record?.status ?? "NOT_MARKED",
      notes: entry.record?.notes ?? "",
    });
  }, [entry, reset]);

  return (
    <Dialog
      open={Boolean(entry)}
      onClose={busy ? () => undefined : onClose}
      title="Edit attendance"
      description={
        entry ? `${entry.subject.name} · ${entry.session.date}` : undefined
      }
    >
      <form
        className="grid gap-4"
        onSubmit={handleSubmit((values) => void onSave(values))}
      >
        <Field label="Attendance status">
          <Select {...register("status")} data-testid="edit-attendance-status">
            <option value="PRESENT">Present</option>
            <option value="ABSENT">Absent</option>
            <option value="EXEMPT">Exempt</option>
            <option value="NOT_MARKED">Not marked</option>
          </Select>
        </Field>
        <Field label="Note" hint="Optional context for this correction.">
          <Textarea
            className="min-h-24"
            placeholder="Why was this changed?"
            {...register("notes")}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} data-testid="save-history-edit">
            {busy ? "Saving…" : "Save correction"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

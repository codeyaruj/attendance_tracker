"use client";

import { AlertTriangle, Download, HardDrive, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";
import type { AttendSafeSnapshot } from "@/db";
import type { PreparedBackupImport } from "@/lib/backup";

export function BackupImportDialog({
  prepared,
  current,
  applying,
  onExportCurrent,
  onConfirm,
  onCancel,
}: {
  prepared?: PreparedBackupImport;
  current: AttendSafeSnapshot;
  applying: boolean;
  onExportCurrent: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  if (!prepared) return null;
  const { preview } = prepared;
  const counts = [
    ["Profiles", preview.profiles],
    ["Semesters", preview.semesters],
    ["Subjects", preview.subjects],
    ["Timetable slots", preview.timetableSlots],
    ["Attendance records", preview.attendanceRecords],
    ["Extra sessions", preview.extraSessions],
    ["Cancelled sessions", preview.cancelledSessions],
    ["Rescheduled sessions", preview.rescheduledSessions],
    ["Holidays", preview.holidays],
    ["Embedded sources", preview.embeddedFiles],
  ] as const;

  return (
    <Dialog
      open
      onClose={() => {
        if (!applying) onCancel();
      }}
      title="Review backup before replacing local data"
      description={`Backup version ${preview.version}, exported ${new Date(preview.exportedAt).toLocaleString()}.`}
    >
      <div className="grid gap-5" data-testid="backup-import-preview">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {counts.map(([label, value]) => (
            <div key={label} className="bg-secondary rounded-xl p-3">
              <p className="text-lg font-extrabold">{value.toLocaleString()}</p>
              <p className="text-muted-foreground text-xs">{label}</p>
            </div>
          ))}
        </div>

        <div className="bg-info-soft text-info-strong flex gap-3 rounded-xl p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" />
          <p>
            Parsing, validation, and import happen locally. No backup data is
            uploaded. Approximate file size:{" "}
            {Math.max(
              1,
              Math.ceil(preview.approximateBytes / 1024),
            ).toLocaleString()}{" "}
            KB.
          </p>
        </div>

        {[...preview.migrationWarnings, ...preview.compatibilityWarnings].map(
          (warning) => (
            <div
              key={warning}
              className="bg-warning-soft text-warning-strong flex gap-3 rounded-xl p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0" /> {warning}
            </div>
          ),
        )}

        <div className="border-danger/30 bg-danger-soft/40 rounded-xl border p-4">
          <p className="text-danger-strong font-bold">
            This replaces current local data
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            The current device has {current.profiles.length} profiles,{" "}
            {current.subjects.length} visible subjects, and{" "}
            {current.attendanceRecords.length} visible attendance records.
            Replacement cannot be undone without a separate export.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={applying}
            onClick={onExportCurrent}
          >
            <Download className="size-4" /> Export current data first
          </Button>
        </div>

        <Field label='Type "REPLACE" to confirm'>
          <Input
            value={confirmation}
            disabled={applying}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
            aria-describedby="backup-replace-warning"
          />
        </Field>
        <p id="backup-replace-warning" className="sr-only">
          Confirming replaces all current local AttendSafe data.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={applying} onClick={onCancel}>
            Cancel without changes
          </Button>
          <Button
            variant="danger"
            disabled={confirmation !== "REPLACE" || applying}
            onClick={onConfirm}
            data-testid="confirm-backup-import"
          >
            <HardDrive className="size-4" />
            {applying ? "Applying transaction…" : "Replace local data"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

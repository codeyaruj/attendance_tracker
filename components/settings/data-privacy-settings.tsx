"use client";

import {
  DatabaseBackup,
  Download,
  FileJson,
  FileSpreadsheet,
  Palette,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form-controls";
import { attendSafeRepository, type AttendSafeSnapshot } from "@/db";
import type { BackupImportProgress, PreparedBackupImport } from "@/lib/backup";
import { beginCriticalOperation } from "@/lib/pwa/critical-operation";
import { recordBackupGenerated } from "@/lib/pwa/storage";
import type { ThemePreference } from "@/types/domain";

import { applyThemePreference, safeExportFilename } from "./settings-model";
import { BackupImportDialog } from "./backup-import-dialog";
import { DeviceStorageSettings } from "./device-storage-settings";
import {
  SettingsConfirmDialog,
  type DestructiveConfirmation,
} from "./settings-confirm-dialog";
import { SettingsSection } from "./settings-section";

const destructiveActions: Record<
  DestructiveConfirmation["id"],
  DestructiveConfirmation
> = {
  ATTENDANCE: {
    id: "ATTENDANCE",
    title: "Reset this semester's attendance?",
    description:
      "Attendance marks and recent undo entries will be removed. The timetable and semester remain.",
    confirmLabel: "Reset attendance",
    confirmationText: "RESET ATTENDANCE",
  },
  SEMESTER: {
    id: "SEMESTER",
    title: "Delete this semester?",
    description:
      "The timetable, subjects, sessions, attendance, closures, and uploads linked to this semester will be removed.",
    confirmLabel: "Delete semester",
    confirmationText: "DELETE SEMESTER",
  },
  PROFILE: {
    id: "PROFILE",
    title: "Delete this local profile?",
    description:
      "Every semester and attendance record for this profile will be removed from this device.",
    confirmLabel: "Delete profile",
    confirmationText: "DELETE PROFILE",
  },
  APP: {
    id: "APP",
    title: "Reset the entire app?",
    description:
      "All profiles, semesters, timetable images, schedules, and attendance records on this device will be erased.",
    confirmLabel: "Reset AttendSafe",
    confirmationText: "RESET APP",
  },
};

function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PreferenceSettings({ data }: { data: AttendSafeSnapshot }) {
  const [theme, setTheme] = useState(data.settings.theme);

  const changeTheme = async (value: ThemePreference) => {
    const previous = theme;
    setTheme(value);
    applyThemePreference(value);
    try {
      await attendSafeRepository.updateSettings({ theme: value });
      toast.success("Theme preference saved");
    } catch (cause) {
      setTheme(previous);
      applyThemePreference(previous);
      toast.error(
        cause instanceof Error ? cause.message : "Theme could not be saved.",
      );
    }
  };

  return (
    <SettingsSection
      id="preferences"
      icon={Palette}
      title="App preferences"
      description="Control this browser's appearance. AttendSafe does not request notification permission or promise background reminders."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Theme"
          hint="System follows your device's light or dark appearance."
        >
          <Select
            value={theme}
            onChange={(event) =>
              void changeTheme(event.target.value as ThemePreference)
            }
          >
            <option value="SYSTEM">Use device setting</option>
            <option value="LIGHT">Light</option>
            <option value="DARK">Dark</option>
          </Select>
        </Field>
        <div className="bg-secondary text-muted-foreground rounded-xl p-4 text-sm leading-6">
          <p className="text-foreground font-bold">No background reminders</p>
          <p>
            There is no push subscription or reliable closed-browser scheduler.
            Notification permission is never requested automatically.
          </p>
          <p className="mt-2 text-xs">
            Offline shell:{" "}
            {data.settings.offlineReady
              ? "ready"
              : "preparing after an online production visit"}
            .
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

export function DataPrivacySettings({ data }: { data: AttendSafeSnapshot }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [selectedSubjectId, setSelectedSubjectId] = useState(
    data.subjects[0]?.id ?? "",
  );
  const [confirmation, setConfirmation] = useState<DestructiveConfirmation>();
  const [destructiveBusy, setDestructiveBusy] = useState(false);
  const [preparedImport, setPreparedImport] = useState<PreparedBackupImport>();
  const [importProgress, setImportProgress] = useState<BackupImportProgress>();
  const importAbortRef = useRef<AbortController | undefined>(undefined);

  const exportJson = async (profileOnly: boolean) => {
    const endCriticalOperation = beginCriticalOperation();
    setBusy(profileOnly ? "PROFILE_EXPORT" : "APP_EXPORT");
    try {
      const json = await attendSafeRepository.exportBackup(
        profileOnly ? data.activeProfile?.id : undefined,
      );
      const label = profileOnly
        ? safeExportFilename(data.activeProfile?.displayName ?? "profile")
        : "all-profiles";
      downloadText(
        json,
        `attendance-tracker-backup-${label}-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      recordBackupGenerated();
      toast.success("JSON backup downloaded");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Backup could not be exported.",
      );
    } finally {
      setBusy(undefined);
      endCriticalOperation();
    }
  };

  const importJson = async (file: File) => {
    if (busy) return;
    const controller = new AbortController();
    const endCriticalOperation = beginCriticalOperation();
    importAbortRef.current = controller;
    setBusy("PREPARE_IMPORT");
    try {
      const prepared = await attendSafeRepository.prepareBackupFile(file, {
        signal: controller.signal,
        onProgress: setImportProgress,
      });
      setPreparedImport(prepared);
      setBusy(undefined);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Backup could not be prepared.",
      );
      setBusy(undefined);
    } finally {
      endCriticalOperation();
      importAbortRef.current = undefined;
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const applyPreparedImport = async () => {
    if (!preparedImport || busy) return;
    const endCriticalOperation = beginCriticalOperation();
    setBusy("APPLY_IMPORT");
    setImportProgress({ stage: "IMPORTING", progress: 1 });
    try {
      await attendSafeRepository.importPreparedBackup(preparedImport);
      const imported = preparedImport.preview;
      setPreparedImport(undefined);
      toast.success(
        `Imported ${imported.subjects} subjects and ${imported.attendanceRecords} attendance records`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Import failed; existing data was preserved.",
      );
    } finally {
      setBusy(undefined);
      setImportProgress(undefined);
      endCriticalOperation();
    }
  };

  const exportCsv = async () => {
    if (!data.activeSemester || !selectedSubjectId) return;
    setBusy("CSV");
    try {
      const csv = await attendSafeRepository.exportSubjectCsv(
        data.activeSemester.id,
        [selectedSubjectId],
      );
      const subject = data.subjects.find(
        (item) => item.id === selectedSubjectId,
      );
      downloadText(
        csv,
        `attendsafe-${safeExportFilename(subject?.shortName ?? "subject")}.csv`,
        "text/csv;charset=utf-8",
      );
      toast.success("Subject CSV downloaded");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "CSV could not be exported.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const runDestructiveAction = async () => {
    if (!confirmation) return;
    setDestructiveBusy(true);
    try {
      switch (confirmation.id) {
        case "ATTENDANCE":
          if (!data.activeSemester)
            throw new Error("No active semester selected.");
          await attendSafeRepository.resetSemesterAttendance(
            data.activeSemester.id,
            true,
          );
          break;
        case "SEMESTER":
          if (!data.activeSemester)
            throw new Error("No active semester selected.");
          await attendSafeRepository.resetSemester(
            data.activeSemester.id,
            true,
          );
          break;
        case "PROFILE":
          if (!data.activeProfile)
            throw new Error("No active profile selected.");
          await attendSafeRepository.deleteProfile(data.activeProfile.id, true);
          break;
        case "APP":
          await attendSafeRepository.resetApp(true);
          break;
      }
      const actionId = confirmation.id;
      setConfirmation(undefined);
      toast.success(
        actionId === "ATTENDANCE"
          ? "Semester attendance reset"
          : actionId === "SEMESTER"
            ? "Semester deleted"
            : actionId === "PROFILE"
              ? "Profile deleted"
              : "AttendSafe reset",
      );
      if (actionId === "APP") window.location.assign("/");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Data could not be reset.",
      );
    } finally {
      setDestructiveBusy(false);
    }
  };

  return (
    <>
      <SettingsSection
        id="backup-privacy"
        icon={DatabaseBackup}
        title="Local data and backups"
        description="Attendance records and saved timetables stay on this device. Timetable images are processed locally by default; only images you explicitly submit for AI assistance are sent to Google Gemini. Data does not automatically appear on another phone, browser, or domain."
      >
        <DeviceStorageSettings offlineReady={data.settings.offlineReady} />
        <p className="text-muted-foreground mb-4 text-sm leading-6">
          Clearing site data, deleting application data, resetting the device,
          or changing browsers may remove your records. Export a backup
          regularly.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border-border rounded-2xl border p-4">
            <div className="flex items-center gap-3">
              <FileJson className="text-primary size-5" aria-hidden="true" />
              <div>
                <h3 className="font-bold">JSON backup</h3>
                <p className="text-muted-foreground text-xs">
                  Created and validated locally. Backups can contain sensitive
                  attendance data, so store them securely.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data.activeProfile || Boolean(busy)}
                onClick={() => void exportJson(true)}
              >
                <Download className="size-4" aria-hidden="true" />
                Active profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.profiles.length === 0 || Boolean(busy)}
                onClick={() => void exportJson(false)}
              >
                <Download className="size-4" aria-hidden="true" />
                All profiles
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden="true" />
                {busy === "PREPARE_IMPORT"
                  ? "Validating…"
                  : busy === "APPLY_IMPORT"
                    ? "Applying…"
                    : "Import backup"}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="Choose AttendSafe JSON backup"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                }}
              />
              {busy === "PREPARE_IMPORT" && importProgress ? (
                <div
                  className="bg-secondary mt-3 w-full rounded-xl p-3 text-xs"
                  role="status"
                  aria-live="polite"
                >
                  {importProgress.stage.replaceAll("_", " ").toLowerCase()}…
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2"
                    onClick={() => importAbortRef.current?.abort()}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-border rounded-2xl border p-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet
                className="text-primary size-5"
                aria-hidden="true"
              />
              <div>
                <h3 className="font-bold">Subject CSV</h3>
                <p className="text-muted-foreground text-xs">
                  Export held, attended, percentage, and thresholds.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Select
                value={selectedSubjectId}
                disabled={data.subjects.length === 0}
                onChange={(event) => setSelectedSubjectId(event.target.value)}
                aria-label="Subject to export"
              >
                {data.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                disabled={!selectedSubjectId || Boolean(busy)}
                onClick={() => void exportCsv()}
              >
                <Download className="size-4" aria-hidden="true" /> Export CSV
              </Button>
            </div>
          </div>
        </div>

        <div className="border-border mt-7 border-t pt-6">
          <h3 className="text-danger-strong font-bold">Destructive actions</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Every action requires its confirmation phrase. These changes do not
            have undo history.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DangerAction
              title="Reset attendance"
              description="Keep this semester and timetable, but remove its attendance marks."
              disabled={!data.activeSemester}
              onClick={() => setConfirmation(destructiveActions.ATTENDANCE)}
            />
            <DangerAction
              title="Delete semester"
              description="Remove the active semester and everything linked to it."
              disabled={!data.activeSemester}
              onClick={() => setConfirmation(destructiveActions.SEMESTER)}
            />
            <DangerAction
              title="Delete profile"
              description="Remove the active profile and all of its semesters."
              disabled={!data.activeProfile}
              onClick={() => setConfirmation(destructiveActions.PROFILE)}
            />
            <DangerAction
              title="Reset entire app"
              description="Erase every local profile and return to onboarding."
              disabled={data.profiles.length === 0}
              onClick={() => setConfirmation(destructiveActions.APP)}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsConfirmDialog
        action={confirmation}
        busy={destructiveBusy}
        onClose={() => setConfirmation(undefined)}
        onConfirm={runDestructiveAction}
      />
      <BackupImportDialog
        prepared={preparedImport}
        current={data}
        applying={busy === "APPLY_IMPORT"}
        onExportCurrent={() => void exportJson(false)}
        onConfirm={() => void applyPreparedImport()}
        onCancel={() => setPreparedImport(undefined)}
      />
    </>
  );
}

function DangerAction({
  title,
  description,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="border-danger/30 bg-danger-soft/40 flex flex-col items-start gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          {description}
        </p>
      </div>
      <Button variant="danger" size="sm" disabled={disabled} onClick={onClick}>
        {title}
      </Button>
    </div>
  );
}

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import { BackupImportDialog } from "@/components/settings/backup-import-dialog";
import { DataPrivacySettings } from "@/components/settings/data-privacy-settings";
import { defaultAppSettings, type AttendSafeSnapshot } from "@/db";
import type { PreparedBackupImport } from "@/lib/backup";
import { BACKUP_LIMITS } from "@/lib/validation";

const prepared: PreparedBackupImport = {
  backup: undefined as never,
  preview: {
    version: 3,
    sourceVersion: 2,
    exportedAt: "2026-07-26T10:00:00.000Z",
    profiles: 2,
    semesters: 3,
    subjects: 8,
    timetableSlots: 42,
    attendanceRecords: 120,
    extraSessions: 2,
    cancelledSessions: 4,
    rescheduledSessions: 1,
    holidays: 6,
    settingsIncluded: true,
    embeddedFiles: 1,
    approximateBytes: 12_000,
    migrationWarnings: ["Migrated legacy backup version 2."],
    compatibilityWarnings: ["Current local data will be replaced."],
  },
};

const current: AttendSafeSnapshot = {
  profiles: [],
  semesters: [],
  timetables: [],
  timetableVersions: [],
  subjects: [],
  electiveGroups: [],
  timetableSlots: [],
  academicExceptions: [],
  classSessions: [],
  attendanceRecords: [],
  uploadedTimetableReferences: [],
  recentActions: [],
  settings: defaultAppSettings("2026-07-26T10:00:00.000Z"),
};

describe("backup import preview", () => {
  it("shows oversized and invalid JSON errors from the local preparation pipeline", async () => {
    const { rerender } = render(
      <>
        <DataPrivacySettings data={current} />
        <Toaster />
      </>,
    );
    const oversized = new File(["{}"], "large.json", {
      type: "application/json",
    });
    Object.defineProperty(oversized, "size", {
      value: BACKUP_LIMITS.maxFileBytes + 1,
    });
    fireEvent.change(screen.getByLabelText("Choose AttendSafe JSON backup"), {
      target: { files: [oversized] },
    });
    expect(await screen.findByText(/no larger than 5 MB/i)).toBeVisible();

    rerender(
      <>
        <DataPrivacySettings data={current} />
        <Toaster />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Choose AttendSafe JSON backup"), {
      target: {
        files: [
          new File(["not-json"], "broken.json", {
            type: "application/json",
          }),
        ],
      },
    });
    expect(
      await screen.findByText(/not an AttendSafe JSON object/i),
    ).toBeVisible();
  });

  it("shows counts and migration/privacy warnings before modification", () => {
    render(
      <BackupImportDialog
        prepared={prepared}
        current={current}
        applying={false}
        onExportCurrent={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("backup-import-preview")).toBeVisible();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/Migrated legacy backup version 2/)).toBeVisible();
    expect(screen.getByText(/No backup data is uploaded/)).toBeVisible();
  });

  it("supports export-first and cancel without applying", () => {
    const onExportCurrent = vi.fn();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <BackupImportDialog
        prepared={prepared}
        current={current}
        applying={false}
        onExportCurrent={onExportCurrent}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /export current data first/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /cancel without changes/i }),
    );
    expect(onExportCurrent).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requires explicit destructive confirmation and blocks duplicate clicks", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BackupImportDialog
        prepared={prepared}
        current={current}
        applying={false}
        onExportCurrent={vi.fn()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId("confirm-backup-import");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type "REPLACE"/), {
      target: { value: "REPLACE" },
    });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();

    rerender(
      <BackupImportDialog
        prepared={prepared}
        current={current}
        applying
        onExportCurrent={vi.fn()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-backup-import")).toBeDisabled();
  });
});

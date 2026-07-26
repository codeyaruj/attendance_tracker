import Dexie from "dexie";

import type {
  AcademicException,
  AppSettings,
  AttendanceStatus,
  ClassSession,
  RecentAction,
  Semester,
  Subject,
  TimetableSlot,
  UploadedTimetableReference,
} from "@/types/domain";
import { storedBinarySize } from "@/lib/stored-binary";

import {
  checkDatabaseHealth,
  getAttendSafeDatabase,
  resetCorruptDatabase,
  retryDatabaseConnection,
  type AttendSafeDatabase,
  type DatabaseHealth,
} from "./database";
import {
  bulkMarkAttendanceWithUndo,
  markAttendanceWithUndo,
  undoRecentAction,
  upsertSessionWithUndo,
  type BulkAttendanceChange,
} from "./recent-actions";
import {
  createEntityId,
  createRepositories,
  entityTimestamps,
} from "./repositories";
import {
  createProfileSetup,
  deleteDemoData,
  deleteProfile,
  exitDemoMode,
  getDatabaseSnapshot,
  installDemoData,
  resetApplication,
  resetSemester,
  resetSemesterAttendance,
  saveAcademicException,
  saveManualTimetable,
  saveTimetableBundle,
  type AttendSafeSnapshot,
  type CreateProfileSetupInput,
  type ProfileSetupResult,
  type ManualTimetableInput,
  type TimetableBundle,
} from "./services";

export * from "./database";
export * from "./recent-actions";
export * from "./repositories";
export * from "./schema";
export * from "./services";

/**
 * A lazy Dexie proxy. Importing `db` is SSR-safe; IndexedDB is only requested
 * when a property is actually used in the browser.
 */
export const db: AttendSafeDatabase = new Proxy({} as AttendSafeDatabase, {
  get(_target, property) {
    const database = getAttendSafeDatabase();
    const value: unknown = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
  set(_target, property, value) {
    return Reflect.set(getAttendSafeDatabase(), property, value);
  },
});

export type MarkAttendanceStatus =
  AttendanceStatus | "CANCELLED" | "NOT_CONDUCTED";

export interface ImportOptions {
  mode?: "REPLACE";
}

export type StoreUploadReferenceInput = Omit<
  UploadedTimetableReference,
  "id" | "size" | "createdAt" | "updatedAt"
> & { id?: string };

export class AttendSafeRepository {
  private database(): AttendSafeDatabase {
    return getAttendSafeDatabase();
  }

  health(): Promise<DatabaseHealth> {
    return checkDatabaseHealth();
  }

  getSnapshot(
    profileId?: string,
    semesterId?: string,
  ): Promise<AttendSafeSnapshot> {
    return getDatabaseSnapshot(this.database(), profileId, semesterId);
  }

  createProfileSetup(
    input: CreateProfileSetupInput,
  ): Promise<ProfileSetupResult> {
    return createProfileSetup(this.database(), input);
  }

  installDemo(displayName?: string): ReturnType<typeof installDemoData> {
    return installDemoData(this.database(), displayName);
  }

  exitDemo(): Promise<void> {
    return exitDemoMode(this.database());
  }

  deleteDemo(confirmed: boolean): Promise<void> {
    return deleteDemoData(this.database(), confirmed);
  }

  saveManualTimetable(input: ManualTimetableInput): Promise<TimetableBundle> {
    return saveManualTimetable(this.database(), input);
  }

  saveTimetableBundle(bundle: TimetableBundle): Promise<TimetableBundle> {
    return saveTimetableBundle(this.database(), bundle);
  }

  saveAcademicException(
    exception: AcademicException,
  ): Promise<AcademicException> {
    return saveAcademicException(this.database(), exception);
  }

  async markAttendance(
    classSessionId: string,
    status: MarkAttendanceStatus,
    notes?: string,
  ): Promise<
    ClassSession | Awaited<ReturnType<typeof markAttendanceWithUndo>>
  > {
    if (status === "CANCELLED" || status === "NOT_CONDUCTED") {
      const database = this.database();
      const session = await database.classSessions.get(classSessionId);
      if (!session) {
        throw new Error(`Class session ${classSessionId} does not exist.`);
      }
      return upsertSessionWithUndo(
        database,
        {
          ...session,
          status,
          ...(notes ? { notes } : {}),
          updatedAt: new Date().toISOString(),
        },
        status === "CANCELLED"
          ? "Cancelled a class"
          : "Marked a class not conducted",
      );
    }
    return markAttendanceWithUndo(
      this.database(),
      classSessionId,
      status,
      notes,
    );
  }

  bulkMarkAttendance(
    changes: readonly BulkAttendanceChange[],
    description?: string,
  ): ReturnType<typeof bulkMarkAttendanceWithUndo> {
    return bulkMarkAttendanceWithUndo(this.database(), changes, description);
  }

  upsertSession(
    session: ClassSession,
    description?: string,
  ): Promise<ClassSession> {
    return upsertSessionWithUndo(this.database(), session, description);
  }

  async updateSubject(
    id: string,
    changes: Partial<Omit<Subject, "id" | "createdAt">>,
  ): Promise<Subject> {
    const repositories = createRepositories(this.database());
    const existing = await repositories.subjects.require(id);
    const semester = await repositories.semesters.require(existing.semesterId);
    const minimum =
      changes.minimumAttendanceBasisPointsOverride ??
      existing.minimumAttendanceBasisPointsOverride ??
      semester.minimumAttendanceBasisPoints;
    const safety =
      changes.safetyTargetBasisPointsOverride ??
      existing.safetyTargetBasisPointsOverride ??
      semester.safetyTargetBasisPoints;
    const held = changes.initialHeld ?? existing.initialHeld;
    const attended = changes.initialAttended ?? existing.initialAttended;
    if (
      minimum < 0 ||
      minimum > 10_000 ||
      safety < minimum ||
      safety > 10_000
    ) {
      throw new Error(
        "Subject thresholds must be valid and safety cannot be below minimum.",
      );
    }
    if (
      !Number.isInteger(held) ||
      !Number.isInteger(attended) ||
      held < 0 ||
      attended < 0 ||
      attended > held
    ) {
      throw new Error("Subject attendance must satisfy 0 ≤ attended ≤ held.");
    }
    return repositories.subjects.update(id, changes);
  }

  async updateSemester(
    id: string,
    changes: Partial<Omit<Semester, "id" | "createdAt">>,
  ): Promise<Semester> {
    const repository = createRepositories(this.database()).semesters;
    const existing = await repository.require(id);
    const minimum =
      changes.minimumAttendanceBasisPoints ??
      existing.minimumAttendanceBasisPoints;
    const safety =
      changes.safetyTargetBasisPoints ?? existing.safetyTargetBasisPoints;
    const startDate = changes.startDate ?? existing.startDate;
    const endDate = changes.endDate ?? existing.endDate;
    if (
      minimum < 0 ||
      minimum > 10_000 ||
      safety < minimum ||
      safety > 10_000
    ) {
      throw new Error(
        "Semester thresholds must be valid and safety cannot be below minimum.",
      );
    }
    if (endDate < startDate) {
      throw new Error("Semester end date must be on or after its start date.");
    }
    return repository.update(id, changes);
  }

  async updateSlot(
    id: string,
    changes: Partial<Omit<TimetableSlot, "id" | "createdAt">>,
  ): Promise<TimetableSlot> {
    const repository = createRepositories(this.database()).timetableSlots;
    const existing = await repository.require(id);
    const startTime = changes.startTime ?? existing.startTime;
    const endTime = changes.endTime ?? existing.endTime;
    if (startTime >= endTime) {
      throw new Error("A timetable slot must end after it starts.");
    }
    return repository.update(id, changes);
  }

  saveException(exception: AcademicException): Promise<AcademicException> {
    return saveAcademicException(this.database(), exception);
  }

  saveUploadReference(
    reference: UploadedTimetableReference,
  ): Promise<UploadedTimetableReference> {
    if (reference.size !== storedBinarySize(reference.blob)) {
      throw new Error("Upload metadata does not match the stored file size.");
    }
    return createRepositories(this.database()).uploadedTimetableReferences.put(
      reference,
    );
  }

  async storeUploadReference(
    input: StoreUploadReferenceInput,
  ): Promise<string> {
    const reference: UploadedTimetableReference = {
      ...input,
      id: input.id ?? createEntityId(),
      size: storedBinarySize(input.blob),
      ...entityTimestamps(),
    };
    await this.saveUploadReference(reference);
    return reference.id;
  }

  updateSettings(
    changes: Partial<Omit<AppSettings, "id">>,
  ): Promise<AppSettings> {
    return createRepositories(this.database()).appSettings.update(changes);
  }

  undo(actionId: string): Promise<RecentAction> {
    return undoRecentAction(this.database(), actionId);
  }

  async exportBackup(profileId?: string): Promise<string> {
    const { exportBackupJson } = await import("@/lib/backup");
    return exportBackupJson(this.database(), { profileId });
  }

  async importBackup(
    backup: string | unknown,
    options?: ImportOptions,
  ): Promise<void> {
    const { importBackup } = await import("@/lib/backup");
    await importBackup(this.database(), backup, options);
  }

  async prepareBackupFile(
    file: File,
    options?: import("@/lib/backup").PrepareBackupOptions,
  ): Promise<import("@/lib/backup").PreparedBackupImport> {
    const { prepareBackupFile } = await import("@/lib/backup");
    return prepareBackupFile(file, options);
  }

  async importPreparedBackup(
    prepared: import("@/lib/backup").PreparedBackupImport,
  ): Promise<void> {
    const { importPreparedBackup } = await import("@/lib/backup");
    await importPreparedBackup(this.database(), prepared, { mode: "REPLACE" });
  }

  retryDatabase(): Promise<DatabaseHealth> {
    return retryDatabaseConnection();
  }

  resetCorruptDatabase(confirmationText: string): Promise<void> {
    return resetCorruptDatabase(confirmationText);
  }

  async exportRecoverableData(): Promise<
    import("@/lib/backup").RecoveryExportResult
  > {
    const { exportRecoverableDatabase } = await import("@/lib/backup");
    return exportRecoverableDatabase(this.database());
  }

  async exportSubjectCsv(
    semesterId: string,
    subjectIds?: readonly string[],
  ): Promise<string> {
    const { exportSubjectAttendanceCsv } = await import("@/lib/backup");
    return exportSubjectAttendanceCsv(this.database(), semesterId, {
      subjectIds,
    });
  }

  resetSemester(semesterId: string, confirmed: boolean): Promise<void> {
    return resetSemester(this.database(), semesterId, confirmed);
  }

  resetSemesterAttendance(
    semesterId: string,
    confirmed: boolean,
  ): Promise<void> {
    return resetSemesterAttendance(this.database(), semesterId, confirmed);
  }

  deleteProfile(profileId: string, confirmed: boolean): Promise<void> {
    return deleteProfile(this.database(), profileId, confirmed);
  }

  resetApp(confirmed: boolean): Promise<void> {
    return resetApplication(this.database(), confirmed);
  }
}

export const attendSafeRepository = new AttendSafeRepository();

let dataVersion = 0;
const dataVersionListeners = new Set<(version: number) => void>();
const onStorageMutated = (): void => {
  dataVersion += 1;
  for (const listener of dataVersionListeners) listener(dataVersion);
};

export function subscribeDataVersion(
  listener: (version: number) => void,
): () => void {
  if (dataVersionListeners.size === 0) {
    Dexie.on.storagemutated.subscribe(onStorageMutated);
  }
  dataVersionListeners.add(listener);
  return () => {
    dataVersionListeners.delete(listener);
    if (dataVersionListeners.size === 0) {
      Dexie.on.storagemutated.unsubscribe(onStorageMutated);
    }
  };
}

export function getDataVersion(): number {
  return dataVersion;
}

// @vitest-environment node

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendSafeDatabase } from "@/db/database";
import { createDemoTimetable } from "@/lib/demo";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupError,
  assertBoundedValue,
  canonicalBackupDataSchema,
  importPreparedBackup,
  migrateBackup,
  prepareBackupFile,
  prepareBackupValue,
  serializedUploadReferenceSchema,
  validateBackupRelationships,
  type AttendSafeBackupFile,
} from "@/lib/backup";
import { BACKUP_LIMITS } from "@/lib/validation";
import {
  academicExceptionSchema,
  attendanceRecordSchema,
  timetableSlotSchema,
} from "@/lib/validation/schemas";

const databases: AttendSafeDatabase[] = [];
const timestamp = "2026-07-26T10:00:00.000Z";

function database(): AttendSafeDatabase {
  const value = new AttendSafeDatabase(
    `backup-security-${crypto.randomUUID()}`,
    {
      indexedDB,
      IDBKeyRange,
    },
  );
  databases.push(value);
  return value;
}

afterEach(async () => {
  for (const value of databases.splice(0)) {
    value.close();
    await value.delete();
  }
});

function validBackup(): AttendSafeBackupFile {
  const demo = createDemoTimetable();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: timestamp,
    appVersion: "0.1.0",
    data: {
      profiles: [demo.profile],
      semesters: [demo.semester],
      timetables: [demo.timetable],
      timetableVersions: [demo.timetableVersion],
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups.map((group) => ({
        ...group,
        allowMultiple: group.allowMultiple ?? false,
      })),
      timetableSlots: demo.timetableSlots,
      academicExceptions: demo.academicExceptions,
      classSessions: [],
      attendanceRecords: [],
      appSettings: [
        {
          ...demo.appSettings,
          includeZeroCredit: demo.appSettings.includeZeroCredit ?? false,
        },
      ],
      recentActions: [],
      uploadedTimetableReferences: [],
    },
  };
}

describe("canonical backup schemas", () => {
  it("accepts a complete current backup and rejects unknown properties", () => {
    expect(prepareBackupValue(validBackup()).backup.version).toBe(3);
    const invalid = { ...validBackup(), unknown: true };
    expect(() => prepareBackupValue(invalid)).toThrow(/unrecognized|invalid/i);
  });

  it("rejects missing fields, invalid enums, and impossible attendance statuses", () => {
    const backup = validBackup();
    const missing = structuredClone(backup) as Record<string, unknown>;
    Reflect.deleteProperty(
      (missing.data as { profiles: Array<Record<string, unknown>> })
        .profiles[0],
      "displayName",
    );
    expect(() => prepareBackupValue(missing)).toThrow();
    expect(
      attendanceRecordSchema.safeParse({
        id: crypto.randomUUID(),
        classSessionId: crypto.randomUUID(),
        status: "MAYBE",
        markedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);
  });

  it("requires ordinary slots to have subjects but permits explicit breaks", () => {
    const slot = validBackup().data.timetableSlots[0];
    expect(
      timetableSlotSchema.safeParse({ ...slot, subjectId: undefined }).success,
    ).toBe(false);
    expect(
      timetableSlotSchema.safeParse({
        ...slot,
        subjectId: undefined,
        isBreak: true,
      }).success,
    ).toBe(true);
  });

  it("rejects partial extra and rescheduled sessions", () => {
    const semesterId = validBackup().data.semesters[0].id;
    const base = {
      id: crypto.randomUUID(),
      semesterId,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(
      academicExceptionSchema.safeParse({ ...base, type: "EXTRA_SESSION" })
        .success,
    ).toBe(false);
    expect(
      academicExceptionSchema.safeParse({
        ...base,
        type: "RESCHEDULED_SESSION",
        replacementDate: "2026-08-02",
      }).success,
    ).toBe(false);
  });

  it("enforces record and string limits", () => {
    const backup = validBackup();
    const subject = backup.data.subjects[0];
    expect(
      canonicalBackupDataSchema.safeParse({
        ...backup.data,
        subjects: Array.from(
          { length: BACKUP_LIMITS.maxSubjects + 1 },
          (_, index) => ({
            ...subject,
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          }),
        ),
      }).success,
    ).toBe(false);
    expect(
      serializedUploadReferenceSchema.safeParse({
        id: crypto.randomUUID(),
        filename: "x".repeat(BACKUP_LIMITS.maxShortStringLength + 1),
        mediaType: "image/png",
        size: 0,
        blobBase64: "",
        rotation: 0,
        zoom: 1,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);
  });
});

describe("bounded parsing and embedded data", () => {
  it("rejects an oversized file before reading it", async () => {
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "size", {
      value: BACKUP_LIMITS.maxFileBytes + 1,
    });
    const text = vi.fn(async () => "{}");
    Object.defineProperty(file, "text", { value: text });
    await expect(prepareBackupFile(file)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects empty files and excessive nesting", async () => {
    await expect(
      prepareBackupFile(
        new File([], "backup.json", { type: "application/json" }),
      ),
    ).rejects.toMatchObject({ code: "FILE_EMPTY" });
    let nested: unknown = "value";
    for (let depth = 0; depth <= BACKUP_LIMITS.maxDepth; depth += 1) {
      nested = { nested };
    }
    expect(() => assertBoundedValue(nested)).toThrowError(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );
  });

  it("rejects excessive object counts iteratively", () => {
    const value = {
      first: Array.from({ length: 75_000 }, () => ({})),
      second: Array.from({ length: 75_000 }, () => ({})),
    };
    expect(() => assertBoundedValue(value)).toThrowError(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );
  });

  it("rejects oversized base64 metadata before decoding", () => {
    const result = serializedUploadReferenceSchema.safeParse({
      id: crypto.randomUUID(),
      filename: "large.png",
      mediaType: "image/png",
      size: BACKUP_LIMITS.maxEmbeddedBlobBytes + 1,
      blobBase64: "",
      rotation: 0,
      zoom: 1,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(result.success).toBe(false);
  });

  it("rejects excessive total decoded blob size", () => {
    const backup = validBackup();
    const bytes = new Uint8Array(BACKUP_LIMITS.maxEmbeddedBlobBytes);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const blobBase64 = Buffer.from(bytes).toString("base64");
    backup.data.uploadedTimetableReferences = Array.from(
      { length: 3 },
      (_, index) => ({
        id: `00000000-0000-4000-8000-00000000009${index}`,
        profileId: backup.data.profiles[0].id,
        semesterId: backup.data.semesters[0].id,
        filename: `table-${index}.png`,
        mediaType: "image/png" as const,
        size: bytes.byteLength,
        blobBase64,
        rotation: 0 as const,
        zoom: 1,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    expect(() => validateBackupRelationships(backup.data)).toThrowError(
      expect.objectContaining({ code: "SCHEMA_INVALID" }),
    );
  });
});

describe("versions, relationships, and atomic replacement", () => {
  it("accepts current, migrates supported legacy, and rejects future versions", () => {
    expect(migrateBackup(validBackup()).sourceVersion).toBe(3);
    const current = validBackup();
    const { uploadedTimetableReferences: ignored, ...legacyData } =
      current.data;
    expect(ignored).toEqual([]);
    const migrated = migrateBackup({
      schemaVersion: 1,
      exportedAt: current.exportedAt,
      product: "AttendSafe",
      data: legacyData,
    });
    expect(migrated.backup.version).toBe(3);
    expect(migrated.warnings).toHaveLength(1);
    expect(() =>
      migrateBackup({
        ...current,
        version: 99,
      }),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }));
  });

  it("rejects duplicate IDs and missing subject references", () => {
    const duplicate = validBackup();
    duplicate.data.subjects.push({ ...duplicate.data.subjects[0] });
    expect(() => validateBackupRelationships(duplicate.data)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_ID" }),
    );
    const dangling = validBackup();
    dangling.data.timetableSlots[0].subjectId = crypto.randomUUID();
    expect(() => validateBackupRelationships(dangling.data)).toThrowError(
      expect.objectContaining({ code: "REFERENCE_INVALID" }),
    );
  });

  it.each(["subjects", "timetableSlots", "attendanceRecords"] as const)(
    "rolls back the complete replacement when %s insertion fails",
    async (tableName) => {
      const target = database();
      const existing = validBackup().data.profiles[0];
      await target.profiles.add({ ...existing, displayName: "Existing data" });
      const prepared = prepareBackupValue(validBackup());
      const table = target[tableName];
      const failure = vi
        .spyOn(table, "bulkAdd")
        .mockRejectedValueOnce(new Error("injected failure"));

      await expect(
        importPreparedBackup(target, prepared, { mode: "REPLACE" }),
      ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
      expect(failure).toHaveBeenCalled();
      expect(await target.profiles.toArray()).toEqual([
        { ...existing, displayName: "Existing data" },
      ]);
      expect(await target.subjects.count()).toBe(0);
    },
  );

  it("never writes when migration or final validation fails", async () => {
    const target = database();
    const invalid = { ...validBackup(), unexpected: "field" };
    expect(() => prepareBackupValue(invalid)).toThrow(BackupError);
    expect(await target.profiles.count()).toBe(0);
  });
});

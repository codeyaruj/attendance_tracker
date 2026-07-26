// @vitest-environment node

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AttendanceRecord,
  ClassSession,
  Profile,
  Semester,
  Subject,
  UploadedTimetableReference,
} from "@/types/domain";

import { AttendSafeDatabase } from "@/db/database";
import { defaultAppSettings } from "@/db/schema";
import {
  createBackup,
  exportBackupJson,
  importBackup,
  parseAndMigrateBackup,
  parseBackupJson,
} from "@/lib/backup";
import { exportSubjectAttendanceCsv } from "@/lib/backup/subject-csv";

const databases: AttendSafeDatabase[] = [];

function createDatabase(): AttendSafeDatabase {
  const database = new AttendSafeDatabase(
    `backup-test-${crypto.randomUUID()}`,
    {
      indexedDB,
      IDBKeyRange,
    },
  );
  databases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const now = "2026-07-23T10:00:00.000Z";

async function seedBackupDatabase(database: AttendSafeDatabase): Promise<{
  profile: Profile;
  semester: Semester;
  subject: Subject;
  session: ClassSession;
  upload: UploadedTimetableReference;
}> {
  const profile: Profile = {
    id: crypto.randomUUID(),
    displayName: "Backup Student",
    timezone: "Asia/Kolkata",
    weekStartsOn: "MONDAY",
    createdAt: now,
    updatedAt: now,
  };
  const semester: Semester = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    name: "Semester 5",
    startDate: "2026-07-01",
    endDate: "2026-12-15",
    minimumAttendanceBasisPoints: 6000,
    safetyTargetBasisPoints: 6500,
    teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    createdAt: now,
    updatedAt: now,
  };
  const subject: Subject = {
    id: crypto.randomUUID(),
    semesterId: semester.id,
    code: "=BEC501",
    name: "Digital Signal Processing",
    shortName: "DSP",
    credits: 3,
    classType: "THEORY",
    isZeroCredit: false,
    isEnabled: true,
    countsCancelledSessions: false,
    exemptPolicy: "EXCLUDED",
    initialHeld: 1,
    initialAttended: 1,
    createdAt: now,
    updatedAt: now,
  };
  const session: ClassSession = {
    id: crypto.randomUUID(),
    semesterId: semester.id,
    subjectId: subject.id,
    date: "2026-07-23",
    startTime: "09:00",
    endTime: "10:00",
    status: "HELD",
    source: "TIMETABLE",
    faculty: ["PJ"],
    createdAt: now,
    updatedAt: now,
  };
  const record: AttendanceRecord = {
    id: crypto.randomUUID(),
    classSessionId: session.id,
    status: "PRESENT",
    markedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const bytes = new TextEncoder().encode("image bytes");
  const upload: UploadedTimetableReference = {
    id: crypto.randomUUID(),
    profileId: profile.id,
    semesterId: semester.id,
    filename: "timetable.png",
    mediaType: "image/png",
    size: bytes.byteLength,
    blob: new Blob([bytes.buffer], { type: "image/png" }),
    rotation: 90,
    zoom: 1.25,
    crop: { top: 1, right: 2, bottom: 3, left: 4 },
    createdAt: now,
    updatedAt: now,
  };
  await database.transaction(
    "rw",
    [
      database.profiles,
      database.semesters,
      database.subjects,
      database.classSessions,
      database.attendanceRecords,
      database.uploadedTimetableReferences,
      database.appSettings,
    ],
    async () => {
      await database.profiles.add(profile);
      await database.semesters.add(semester);
      await database.subjects.add(subject);
      await database.classSessions.add(session);
      await database.attendanceRecords.add(record);
      await database.uploadedTimetableReferences.add(upload);
      await database.appSettings.put({
        ...defaultAppSettings(now),
        activeProfileId: profile.id,
        activeSemesterId: semester.id,
      });
    },
  );
  return { profile, semester, subject, session, upload };
}

describe("AttendSafe backup", () => {
  it("round-trips validated JSON including local upload blobs", async () => {
    const source = createDatabase();
    const seeded = await seedBackupDatabase(source);
    const json = await exportBackupJson(source);
    const target = createDatabase();

    await importBackup(target, json, { mode: "REPLACE" });

    expect(await target.profiles.get(seeded.profile.id)).toEqual(
      seeded.profile,
    );
    expect(await target.attendanceRecords.count()).toBe(1);
    const importedUpload = await target.uploadedTimetableReferences.get(
      seeded.upload.id,
    );
    expect(importedUpload?.rotation).toBe(90);
    expect(await importedUpload?.blob.text()).toBe("image bytes");
  });

  it("rejects malformed JSON and broken foreign-key references before writing", async () => {
    const source = createDatabase();
    await seedBackupDatabase(source);
    const backup = await createBackup(source);
    backup.data.classSessions[0]!.subjectId = crypto.randomUUID();
    const target = createDatabase();

    expect(() => parseBackupJson("not json")).toThrow("not valid JSON");
    await expect(importBackup(target, backup)).rejects.toThrow();
    expect(await target.profiles.count()).toBe(0);
  });

  it("migrates schema version 1 backups by adding empty upload references", async () => {
    const source = createDatabase();
    await seedBackupDatabase(source);
    const current = await createBackup(source);
    const { uploadedTimetableReferences: ignored, ...legacyData } =
      current.data;
    expect(ignored).toHaveLength(1);

    const migrated = parseAndMigrateBackup({
      schemaVersion: 1,
      exportedAt: current.exportedAt,
      product: "AttendSafe",
      data: legacyData,
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.data.uploadedTimetableReferences).toEqual([]);
  });

  it("exports spreadsheet-safe subject attendance CSV", async () => {
    const database = createDatabase();
    const { semester } = await seedBackupDatabase(database);

    const csv = await exportSubjectAttendanceCsv(database, semester.id);

    expect(csv).toContain('"\'=BEC501"');
    expect(csv).toContain('"2","2","100.00%"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

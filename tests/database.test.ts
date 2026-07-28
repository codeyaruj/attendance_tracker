import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { ClassSession, Subject } from "@/types/domain";

import { AttendSafeDatabase, checkDatabaseHealth } from "@/db/database";
import { AttendSafeRepository } from "@/db/index";
import {
  applyHistoricalAttendanceWithUndo,
  markAttendanceWithUndo,
  undoRecentAction,
} from "@/db/recent-actions";
import { createRepositories } from "@/db/repositories";
import { SCHEMA_V1, SCHEMA_V3 } from "@/db/schema";
import {
  createProfileSetup,
  resetApplication,
  deleteDemoData,
  exitDemoMode,
  installDemoData,
  resetSemester,
} from "@/db/services";

const openDatabases: AttendSafeDatabase[] = [];

function createDatabase(): AttendSafeDatabase {
  const database = new AttendSafeDatabase(
    `attendsafe-test-${crypto.randomUUID()}`,
    {
      indexedDB,
      IDBKeyRange,
    },
  );
  openDatabases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
    await database.delete();
  }
});

const now = "2026-07-23T10:00:00.000Z";

function subjectFixture(semesterId: string): Subject {
  return {
    id: crypto.randomUUID(),
    semesterId,
    code: "BEC501",
    name: "Digital Signal Processing",
    shortName: "DSP",
    credits: 3,
    classType: "THEORY",
    isZeroCredit: false,
    isEnabled: true,
    countsCancelledSessions: false,
    exemptPolicy: "EXCLUDED",
    initialHeld: 0,
    initialAttended: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function sessionFixture(semesterId: string, subjectId: string): ClassSession {
  return {
    id: crypto.randomUUID(),
    semesterId,
    subjectId,
    date: "2026-07-23",
    startTime: "09:00",
    endTime: "10:00",
    status: "SCHEDULED",
    source: "TIMETABLE",
    faculty: ["PJ"],
    createdAt: now,
    updatedAt: now,
  };
}

describe("AttendSafeDatabase", () => {
  it("opens the complete versioned schema and reports healthy storage", async () => {
    const database = createDatabase();
    await database.open();

    expect(database.verno).toBe(4);
    expect(database.tables.map((table) => table.name).sort()).toEqual(
      [
        "academicExceptions",
        "appSettings",
        "attendanceRecords",
        "classSessions",
        "electiveGroups",
        "profiles",
        "recentActions",
        "semesters",
        "subjects",
        "timetableSlots",
        "timetableVersions",
        "timetables",
        "uploadedTimetableReferences",
      ].sort(),
    );
    await expect(checkDatabaseHealth(database)).resolves.toEqual({
      status: "READY",
    });
  });

  it("migrates legacy records with safe defaults", async () => {
    const name = `attendsafe-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(1).stores(SCHEMA_V1);
    await legacy.open();
    const profileId = crypto.randomUUID();
    const semesterId = crypto.randomUUID();
    await legacy.table("profiles").add({
      id: profileId,
      displayName: "Legacy Student",
      timezone: "",
      createdAt: now,
      updatedAt: now,
    });
    await legacy.table("semesters").add({
      id: semesterId,
      profileId,
      name: "Legacy Semester",
      startDate: "2026-01-01",
      endDate: "2026-06-01",
      minimumAttendanceBasisPoints: 6000,
      safetyTargetBasisPoints: 6500,
      teachingDays: ["MONDAY"],
      createdAt: now,
      updatedAt: now,
    });
    const subject = subjectFixture(semesterId);
    const legacySubject = { ...subject };
    Reflect.deleteProperty(legacySubject, "countsCancelledSessions");
    Reflect.deleteProperty(legacySubject, "exemptPolicy");
    Reflect.deleteProperty(legacySubject, "initialHeld");
    Reflect.deleteProperty(legacySubject, "initialAttended");
    await legacy.table("subjects").add(legacySubject);
    legacy.close();

    const database = new AttendSafeDatabase(name, { indexedDB, IDBKeyRange });
    openDatabases.push(database);
    await database.open();

    expect(await database.profiles.get(profileId)).toMatchObject({
      timezone: "Asia/Kolkata",
      weekStartsOn: "MONDAY",
    });
    expect(await database.subjects.get(subject.id)).toMatchObject({
      countsCancelledSessions: false,
      exemptPolicy: "EXCLUDED",
      initialHeld: 0,
      initialAttended: 0,
    });
  });

  it("retires the misleading reminder-preparation flag in version 4", async () => {
    const name = `attendsafe-notification-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(3).stores(SCHEMA_V3);
    await legacy.open();
    await legacy.table("appSettings").put({
      id: "app",
      theme: "SYSTEM",
      trackedClassTypes: {
        THEORY: true,
        LAB: false,
        TUTORIAL: false,
        SEMINAR: false,
        PROJECT: false,
        OTHER: false,
      },
      includeZeroCredit: false,
      offlineReady: true,
      notificationsPrepared: true,
      updatedAt: now,
    });
    legacy.close();

    const database = new AttendSafeDatabase(name, { indexedDB, IDBKeyRange });
    openDatabases.push(database);
    await database.open();

    expect(await database.appSettings.get("app")).toMatchObject({
      offlineReady: true,
      notificationsPrepared: false,
    });
  });

  it("creates a profile and semester atomically with active settings", async () => {
    const database = createDatabase();
    const setup = await createProfileSetup(database, {
      profile: {
        displayName: "  Asha  ",
        batch: "C4",
        batches: ["C4", "G1"],
      },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
        minimumAttendanceBasisPoints: 6750,
        safetyTargetBasisPoints: 7000,
      },
    });

    expect(setup.profile).toMatchObject({
      displayName: "Asha",
      batch: "C4",
      batches: ["C4", "G1"],
    });
    expect(await database.profiles.count()).toBe(1);
    expect(await database.semesters.count()).toBe(1);
    expect(await database.appSettings.get("app")).toMatchObject({
      activeProfileId: setup.profile.id,
      activeSemesterId: setup.semester.id,
      selectedBatch: "C4",
      selectedBatches: ["C4", "G1"],
    });
  });

  it("creates setup holidays and breaks atomically inside the semester", async () => {
    const database = createDatabase();
    const setup = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
      academicExceptions: [
        {
          type: "HOLIDAY",
          startDate: "2026-08-15",
          endDate: "2026-08-15",
          notes: "Holiday: Independence Day",
        },
        {
          type: "BREAK",
          startDate: "2026-11-20",
          endDate: "2026-11-27",
          notes: "Reading / exam period: Reading week",
        },
      ],
    });

    expect(await database.academicExceptions.toArray()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          semesterId: setup.semester.id,
          type: "HOLIDAY",
          startDate: "2026-08-15",
          endDate: "2026-08-15",
          notes: "Holiday: Independence Day",
        }),
        expect.objectContaining({
          semesterId: setup.semester.id,
          type: "BREAK",
          startDate: "2026-11-20",
          endDate: "2026-11-27",
          notes: "Reading / exam period: Reading week",
        }),
      ]),
    );
  });

  it("rejects academic exceptions outside their semester in setup and Settings persistence", async () => {
    const database = createDatabase();
    await expect(
      createProfileSetup(database, {
        profile: { displayName: "Asha" },
        semester: {
          name: "Semester 5",
          startDate: "2026-07-01",
          endDate: "2026-12-15",
        },
        academicExceptions: [
          {
            type: "HOLIDAY",
            startDate: "2027-01-01",
            endDate: "2027-01-01",
          },
        ],
      }),
    ).rejects.toThrow("inside the semester");
    expect(await database.profiles.count()).toBe(0);

    const { semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const repository = new AttendSafeRepository();
    Object.defineProperty(repository, "database", {
      value: () => database,
    });
    await expect(
      repository.saveException({
        id: crypto.randomUUID(),
        semesterId: semester.id,
        type: "BREAK",
        startDate: "2026-12-10",
        endDate: "2026-12-20",
        notes: "Exam break",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow("inside the semester");
    expect(await database.academicExceptions.count()).toBe(0);
  });

  it("supports typed repositories and recent attendance undo", async () => {
    const database = createDatabase();
    const { profile, semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const repositories = createRepositories(database);
    const subject = subjectFixture(semester.id);
    const session = sessionFixture(semester.id, subject.id);
    await repositories.subjects.add(subject);
    await repositories.classSessions.add(session);

    const record = await markAttendanceWithUndo(
      database,
      session.id,
      "PRESENT",
    );
    expect(record.status).toBe("PRESENT");
    const actions = await repositories.recentActions.listRecent(profile.id);
    expect(actions).toHaveLength(1);

    await undoRecentAction(database, actions[0]!.id);
    expect(
      await repositories.attendanceRecords.getForSession(session.id),
    ).toBeUndefined();
    expect(
      (await repositories.recentActions.get(actions[0]!.id))?.undoneAt,
    ).toBeTruthy();
  });

  it("materialises a historical class and mark atomically, then undoes both", async () => {
    const database = createDatabase();
    const { profile, semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const subject = subjectFixture(semester.id);
    const session = {
      ...sessionFixture(semester.id, subject.id),
      date: "2026-07-20",
    };
    await database.subjects.add(subject);

    const result = await applyHistoricalAttendanceWithUndo(
      database,
      [{ session, status: "PRESENT", notes: "Backfilled from register" }],
      { maximumDate: "2026-07-23" },
    );

    expect(result.changedCount).toBe(1);
    expect(await database.classSessions.get(session.id)).toMatchObject({
      id: session.id,
      status: "SCHEDULED",
    });
    expect(
      await database.attendanceRecords
        .where("classSessionId")
        .equals(session.id)
        .first(),
    ).toMatchObject({
      status: "PRESENT",
      notes: "Backfilled from register",
    });
    const actions = await database.recentActions
      .where("profileId")
      .equals(profile.id)
      .toArray();
    expect(actions).toHaveLength(1);

    await undoRecentAction(database, actions[0]!.id);
    expect(await database.classSessions.get(session.id)).toBeUndefined();
    expect(
      await database.attendanceRecords
        .where("classSessionId")
        .equals(session.id)
        .count(),
    ).toBe(0);
  });

  it("supports correction, unknown removal, exceptional states, and duplicate-tap no-ops", async () => {
    const database = createDatabase();
    const { semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const subject = subjectFixture(semester.id);
    const session = {
      ...sessionFixture(semester.id, subject.id),
      date: "2026-07-20",
    };
    await database.subjects.add(subject);

    await applyHistoricalAttendanceWithUndo(
      database,
      [{ session, status: "ABSENT" }],
      { maximumDate: "2026-07-23" },
    );
    const duplicate = await applyHistoricalAttendanceWithUndo(
      database,
      [{ session, status: "ABSENT" }],
      { maximumDate: "2026-07-23" },
    );
    expect(duplicate.changedCount).toBe(0);
    expect(await database.recentActions.count()).toBe(1);

    await applyHistoricalAttendanceWithUndo(
      database,
      [{ session, status: "NOT_CONDUCTED" }],
      { maximumDate: "2026-07-23" },
    );
    expect(await database.classSessions.get(session.id)).toMatchObject({
      status: "NOT_CONDUCTED",
    });
    expect(await database.attendanceRecords.count()).toBe(0);

    await applyHistoricalAttendanceWithUndo(
      database,
      [{ session, status: "NOT_MARKED" }],
      { maximumDate: "2026-07-23" },
    );
    expect(await database.classSessions.get(session.id)).toMatchObject({
      status: "SCHEDULED",
    });
    expect(await database.attendanceRecords.count()).toBe(0);
  });

  it("applies a whole historical day as one action and rejects future attendance", async () => {
    const database = createDatabase();
    const { semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const subject = subjectFixture(semester.id);
    const first = {
      ...sessionFixture(semester.id, subject.id),
      date: "2026-07-20",
    };
    const second = {
      ...sessionFixture(semester.id, subject.id),
      date: "2026-07-20",
      startTime: "10:00",
      endTime: "11:00",
    };
    await database.subjects.add(subject);

    const result = await applyHistoricalAttendanceWithUndo(
      database,
      [
        { session: first, status: "PRESENT" },
        { session: second, status: "PRESENT" },
      ],
      { maximumDate: "2026-07-23", description: "Marked a day present" },
    );
    expect(result.changedCount).toBe(2);
    expect(await database.classSessions.count()).toBe(2);
    expect(await database.attendanceRecords.count()).toBe(2);
    expect(await database.recentActions.count()).toBe(1);

    await expect(
      applyHistoricalAttendanceWithUndo(
        database,
        [
          {
            session: { ...first, id: crypto.randomUUID(), date: "2026-07-24" },
            status: "PRESENT",
          },
        ],
        { maximumDate: "2026-07-23" },
      ),
    ).rejects.toThrow("Future attendance");
  });

  it("preserves cancellation notes on the dated class session", async () => {
    const database = createDatabase();
    const { semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const subject = subjectFixture(semester.id);
    const session = sessionFixture(semester.id, subject.id);
    await database.subjects.add(subject);
    await database.classSessions.add(session);
    const repository = new AttendSafeRepository();
    Object.defineProperty(repository, "database", {
      value: () => database,
    });

    await repository.markAttendance(
      session.id,
      "CANCELLED",
      "Faculty unavailable",
    );

    expect(await database.classSessions.get(session.id)).toMatchObject({
      status: "CANCELLED",
      notes: "Faculty unavailable",
    });
  });

  it("cascades semester reset and refuses destructive operations without confirmation", async () => {
    const database = createDatabase();
    const { profile, semester } = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const subject = subjectFixture(semester.id);
    const session = sessionFixture(semester.id, subject.id);
    await database.subjects.add(subject);
    await database.classSessions.add(session);
    await markAttendanceWithUndo(database, session.id, "ABSENT");

    await expect(resetSemester(database, semester.id, false)).rejects.toThrow(
      "requires confirmation",
    );
    await resetSemester(database, semester.id, true);

    expect(await database.profiles.get(profile.id)).toBeDefined();
    expect(await database.semesters.get(semester.id)).toBeUndefined();
    expect(await database.subjects.count()).toBe(0);
    expect(await database.classSessions.count()).toBe(0);
    expect(await database.attendanceRecords.count()).toBe(0);
  });

  it("clears the app transactionally and restores default settings", async () => {
    const database = createDatabase();
    await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });

    await resetApplication(database, true);

    expect(await database.profiles.count()).toBe(0);
    expect(await database.semesters.count()).toBe(0);
    expect(await database.appSettings.get("app")).toMatchObject({
      id: "app",
      theme: "SYSTEM",
    });
  });

  it("exits demo mode without deleting demo records", async () => {
    const database = createDatabase();
    const demo = await installDemoData(database);

    await exitDemoMode(database);

    expect(await database.profiles.get(demo.profile.id)).toBeDefined();
    expect(await database.semesters.get(demo.semester.id)).toBeDefined();
    expect(await database.timetableSlots.count()).toBeGreaterThan(0);
    expect(await database.appSettings.get("app")).toMatchObject({
      activeProfileId: undefined,
      activeSemesterId: undefined,
      selectedBatch: undefined,
      selectedBatches: undefined,
    });
  });

  it("deletes only demo data after separate confirmation", async () => {
    const database = createDatabase();
    const real = await createProfileSetup(database, {
      profile: { displayName: "Asha" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
      },
    });
    const demo = await installDemoData(database);
    await database.appSettings.update("app", {
      activeProfileId: real.profile.id,
      activeSemesterId: real.semester.id,
    });

    await expect(deleteDemoData(database, false)).rejects.toThrow(
      "requires confirmation",
    );
    await deleteDemoData(database, true);

    expect(await database.profiles.get(demo.profile.id)).toBeUndefined();
    expect(await database.profiles.get(real.profile.id)).toBeDefined();
    expect(await database.appSettings.get("app")).toMatchObject({
      activeProfileId: real.profile.id,
      activeSemesterId: real.semester.id,
    });
  });
});

import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { persistPlannedAbsences } from "@/components/planner/planner-persistence";
import { AttendSafeDatabase, setDatabaseForTesting } from "@/db/database";
import { createProfileSetup } from "@/db/services";
import type { ResolvedSession, Subject } from "@/types/domain";

const databases: AttendSafeDatabase[] = [];

function createDatabase(): AttendSafeDatabase {
  const database = new AttendSafeDatabase(
    `attendsafe-planner-${crypto.randomUUID()}`,
    { indexedDB, IDBKeyRange },
  );
  databases.push(database);
  setDatabaseForTesting(database);
  return database;
}

afterEach(async () => {
  setDatabaseForTesting(undefined);
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

describe("planned absence persistence", () => {
  it("creates missing lazy sessions and one undoable bulk absence action", async () => {
    const database = createDatabase();
    const setup = await createProfileSetup(database, {
      profile: { displayName: "Planner Student" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-01",
      },
    });
    const now = "2026-07-23T10:00:00.000Z";
    const subject: Subject = {
      id: crypto.randomUUID(),
      semesterId: setup.semester.id,
      name: "Digital Signal Processing",
      shortName: "DSP",
      credits: 4,
      classType: "THEORY",
      isZeroCredit: false,
      isEnabled: true,
      countsCancelledSessions: false,
      exemptPolicy: "EXCLUDED",
      initialHeld: 14,
      initialAttended: 10,
      createdAt: now,
      updatedAt: now,
    };
    await database.subjects.add(subject);
    const sessions: ResolvedSession[] = [
      {
        id: "timetable:slot-1:2026-07-24",
        semesterId: setup.semester.id,
        subjectId: subject.id,
        timetableSlotId: "slot-1",
        date: "2026-07-24",
        startTime: "09:00",
        endTime: "10:00",
        status: "SCHEDULED",
        source: "TIMETABLE",
        faculty: ["PJ"],
        attendanceStatus: "NOT_MARKED",
      },
      {
        id: "timetable:slot-2:2026-07-25",
        semesterId: setup.semester.id,
        subjectId: subject.id,
        timetableSlotId: "slot-2",
        date: "2026-07-25",
        startTime: "10:00",
        endTime: "11:00",
        status: "SCHEDULED",
        source: "TIMETABLE",
        faculty: ["PJ"],
        attendanceStatus: "NOT_MARKED",
      },
    ];

    await expect(persistPlannedAbsences(sessions)).resolves.toBe(2);
    expect(await database.classSessions.count()).toBe(2);
    expect(
      (await database.attendanceRecords.toArray()).map(
        (record) => record.status,
      ),
    ).toEqual(["ABSENT", "ABSENT"]);
    expect(await database.recentActions.count()).toBe(1);
    expect((await database.recentActions.toArray())[0]).toMatchObject({
      kind: "RESTORE_ATTENDANCE_BATCH",
      description: "Planned 2 absences",
    });
  });
});

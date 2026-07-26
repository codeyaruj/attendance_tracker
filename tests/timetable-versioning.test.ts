import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { AttendSafeDatabase } from "@/db/database";
import {
  createProfileSetup,
  saveManualTimetable,
  saveTimetableBundle,
} from "@/db/services";

const databases: AttendSafeDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    await database.delete();
  }
});

describe("dated timetable editing", () => {
  it("closes the superseded version atomically and preserves its slots", async () => {
    const database = new AttendSafeDatabase(
      `timetable-version-${crypto.randomUUID()}`,
      { indexedDB, IDBKeyRange },
    );
    databases.push(database);
    const setup = await createProfileSetup(database, {
      profile: { displayName: "Asha", timezone: "Asia/Kolkata" },
      semester: {
        name: "Semester 5",
        startDate: "2026-07-01",
        endDate: "2026-12-15",
        teachingDays: ["MONDAY", "TUESDAY"],
      },
    });
    const first = await saveManualTimetable(database, {
      semesterId: setup.semester.id,
      title: "ECE timetable",
      effectiveStartDate: "2026-07-01",
      subjects: [
        {
          clientId: "dsp",
          name: "Digital Signal Processing",
          shortName: "DSP",
        },
      ],
      slots: [
        {
          subjectId: "dsp",
          dayOfWeek: "MONDAY",
          startTime: "09:00",
          endTime: "10:00",
        },
      ],
    });
    const now = "2026-07-23T10:00:00.000Z";
    const secondVersionId = crypto.randomUUID();
    const second = {
      timetable: { ...first.timetable, updatedAt: now },
      version: {
        ...first.version,
        id: secondVersionId,
        version: 2,
        label: "August schedule",
        effectiveStartDate: "2026-08-01",
        createdAt: now,
        updatedAt: now,
      },
      subjects: first.subjects,
      electiveGroups: first.electiveGroups,
      slots: first.slots.map((slot) => ({
        ...slot,
        id: crypto.randomUUID(),
        timetableVersionId: secondVersionId,
        startTime: "10:00",
        endTime: "11:00",
        createdAt: now,
        updatedAt: now,
      })),
      activate: true,
      supersedesVersionId: first.version.id,
    };

    await saveTimetableBundle(database, second);

    expect(
      await database.timetableVersions.get(first.version.id),
    ).toMatchObject({
      effectiveStartDate: "2026-07-01",
      effectiveEndDate: "2026-07-31",
    });
    expect(await database.timetableVersions.get(secondVersionId)).toMatchObject(
      {
        version: 2,
        effectiveStartDate: "2026-08-01",
      },
    );
    expect(
      await database.timetableSlots
        .where("timetableVersionId")
        .equals(first.version.id)
        .count(),
    ).toBe(1);
    expect(
      await database.timetableSlots
        .where("timetableVersionId")
        .equals(secondVersionId)
        .count(),
    ).toBe(1);
    expect(
      (await database.semesters.get(setup.semester.id))
        ?.activeTimetableVersionId,
    ).toBe(secondVersionId);
  });
});

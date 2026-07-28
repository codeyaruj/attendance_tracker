import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createDemoTimetable, DEMO_IDS } from "@/lib/demo";
import {
  isSessionEligibleForAbsence,
  resolveSessionsForDate,
  resolveSessionsInRange,
} from "@/lib/timetable";
import type {
  AcademicException,
  ClassType,
  TimetableSlot,
} from "@/types/domain";

const allClassTypes: Record<ClassType, boolean> = {
  THEORY: true,
  LAB: true,
  TUTORIAL: true,
  SEMINAR: true,
  PROJECT: true,
  OTHER: true,
};
const timestamp = "2026-07-01T00:00:00.000Z";

function context() {
  const demo = createDemoTimetable();
  return {
    demo,
    input: {
      semester: demo.semester,
      timetableVersions: [demo.timetableVersion],
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedBatch: demo.selection.selectedBatch,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
      includeZeroCredit: true,
    },
  };
}

describe("academic exception-aware lazy session resolution", () => {
  it("suppresses recurring classes outside teaching days but keeps explicit additions", () => {
    const { demo, input } = context();
    const tuesdayExtra: AcademicException = {
      id: "00000000-0000-4000-8000-000000000399",
      semesterId: demo.semester.id,
      subjectId: DEMO_IDS.dsp,
      type: "EXTRA_SESSION",
      startDate: "2026-07-07",
      endDate: "2026-07-07",
      startTime: "17:00",
      endTime: "18:00",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const sessions = resolveSessionsForDate({
      ...input,
      semester: { ...demo.semester, teachingDays: ["MONDAY"] },
      date: "2026-07-07",
      academicExceptions: [tuesdayExtra],
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: "EXTRA", status: "EXTRA" });
  });

  it("uses stable valid UUIDs for recurring, extra, and rescheduled occurrences", () => {
    const { demo, input } = context();
    const sourceSlot = demo.timetableSlots.find(
      (slot) => slot.subjectId === DEMO_IDS.dsp && slot.dayOfWeek === "MONDAY",
    )!;
    const extra: AcademicException = {
      id: "00000000-0000-4000-8000-000000000398",
      semesterId: demo.semester.id,
      subjectId: DEMO_IDS.dsp,
      type: "EXTRA_SESSION",
      startDate: "2026-07-06",
      endDate: "2026-07-06",
      startTime: "17:00",
      endTime: "18:00",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const rescheduled: AcademicException = {
      id: "00000000-0000-4000-8000-000000000397",
      semesterId: demo.semester.id,
      timetableSlotId: sourceSlot.id,
      type: "RESCHEDULED_SESSION",
      startDate: "2026-07-13",
      endDate: "2026-07-13",
      replacementDate: "2026-07-06",
      startTime: "18:00",
      endTime: "19:00",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const resolve = () =>
      resolveSessionsForDate({
        ...input,
        date: "2026-07-06",
        academicExceptions: [extra, rescheduled],
      });
    const first = resolve();
    const second = resolve();
    const sources = new Set(first.map((session) => session.source));

    expect(sources).toEqual(new Set(["TIMETABLE", "EXTRA", "RESCHEDULED"]));
    first.forEach((session) =>
      expect(z.string().uuid().parse(session.id)).toBe(session.id),
    );
    expect(second.map((session) => session.id)).toEqual(
      first.map((session) => session.id),
    );
  });

  it("marks one cancelled occurrence without affecting the recurring slot", () => {
    const { demo, input } = context();
    const dspTuesday = demo.timetableSlots.find(
      (slot) => slot.subjectId === DEMO_IDS.dsp && slot.dayOfWeek === "TUESDAY",
    );
    const cancellation: AcademicException = {
      id: "00000000-0000-4000-8000-000000000302",
      semesterId: demo.semester.id,
      timetableSlotId: dspTuesday?.id,
      type: "CANCELLED_SESSION",
      startDate: "2026-07-07",
      endDate: "2026-07-07",
      notes: "Faculty unavailable",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const cancelled = resolveSessionsForDate({
      ...input,
      date: "2026-07-07",
      academicExceptions: [cancellation],
    }).find((session) => session.subjectId === DEMO_IDS.dsp);
    const followingWeek = resolveSessionsForDate({
      ...input,
      date: "2026-07-14",
      academicExceptions: [cancellation],
    }).find((session) => session.subjectId === DEMO_IDS.dsp);

    expect(cancelled?.status).toBe("CANCELLED");
    expect(isSessionEligibleForAbsence(cancelled!)).toBe(false);
    expect(followingWeek?.status).toBe("SCHEDULED");
  });

  it("marks every scheduled class in a holiday range as non-skippable", () => {
    const { demo, input } = context();
    const holiday: AcademicException = {
      id: "00000000-0000-4000-8000-000000000302",
      semesterId: demo.semester.id,
      type: "HOLIDAY",
      startDate: "2026-07-08",
      endDate: "2026-07-08",
      notes: "College holiday",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sessions = resolveSessionsForDate({
      ...input,
      date: "2026-07-08",
      academicExceptions: [holiday],
    });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.status === "HOLIDAY")).toBe(
      true,
    );
    expect(
      sessions.every((session) => !isSessionEligibleForAbsence(session)),
    ).toBe(true);
  });

  it("includes an extra session on a day with no recurring version slot", () => {
    const { demo, input } = context();
    const extra: AcademicException = {
      id: "00000000-0000-4000-8000-000000000302",
      semesterId: demo.semester.id,
      subjectId: DEMO_IDS.dsp,
      type: "EXTRA_SESSION",
      startDate: "2026-07-11",
      endDate: "2026-07-11",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["AK"],
      room: "AB-301",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sessions = resolveSessionsForDate({
      ...input,
      date: "2026-07-11",
      academicExceptions: [extra],
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      subjectId: DEMO_IDS.dsp,
      status: "EXTRA",
      source: "EXTRA",
    });
    expect(isSessionEligibleForAbsence(sessions[0])).toBe(true);
  });

  it("moves a rescheduled occurrence to its replacement date", () => {
    const { demo, input } = context();
    const dspTuesday = demo.timetableSlots.find(
      (slot) => slot.subjectId === DEMO_IDS.dsp && slot.dayOfWeek === "TUESDAY",
    );
    const reschedule: AcademicException = {
      id: "00000000-0000-4000-8000-000000000302",
      semesterId: demo.semester.id,
      timetableSlotId: dspTuesday?.id,
      type: "RESCHEDULED_SESSION",
      startDate: "2026-07-07",
      endDate: "2026-07-07",
      replacementDate: "2026-07-08",
      startTime: "15:00",
      endTime: "16:00",
      faculty: ["AK"],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const original = resolveSessionsForDate({
      ...input,
      date: "2026-07-07",
      academicExceptions: [reschedule],
    }).find((session) => session.subjectId === DEMO_IDS.dsp);
    const replacement = resolveSessionsForDate({
      ...input,
      date: "2026-07-08",
      academicExceptions: [reschedule],
    }).find((session) => session.source === "RESCHEDULED");

    expect(original?.status).toBe("CANCELLED");
    expect(isSessionEligibleForAbsence(original!)).toBe(false);
    expect(replacement).toMatchObject({
      subjectId: DEMO_IDS.dsp,
      startTime: "15:00",
      endTime: "16:00",
      status: "RESCHEDULED",
      source: "RESCHEDULED",
    });
  });

  it("applies one-off room and faculty overrides", () => {
    const { demo, input } = context();
    const dspMonday = demo.timetableSlots.find(
      (slot) => slot.subjectId === DEMO_IDS.dsp && slot.dayOfWeek === "MONDAY",
    );
    const override: AcademicException = {
      id: "00000000-0000-4000-8000-000000000302",
      semesterId: demo.semester.id,
      timetableSlotId: dspMonday?.id,
      type: "SESSION_OVERRIDE",
      startDate: "2026-07-06",
      endDate: "2026-07-06",
      room: "Auditorium",
      faculty: ["Guest Faculty"],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const session = resolveSessionsForDate({
      ...input,
      date: "2026-07-06",
      academicExceptions: [override],
    }).find((candidate) => candidate.subjectId === DEMO_IDS.dsp);

    expect(session?.room).toBe("Auditorium");
    expect(session?.faculty).toEqual(["Guest Faculty"]);
  });

  it("resolves a bounded range lazily and preserves two same-subject classes", () => {
    const { demo, input } = context();
    const secondMondayDsp: TimetableSlot = {
      ...demo.timetableSlots[0],
      id: "00000000-0000-4000-8000-000000000226",
      startTime: "16:00",
      endTime: "17:00",
    };
    const sessions = resolveSessionsInRange({
      ...input,
      slots: [...input.slots, secondMondayDsp],
      startDate: "2026-07-06",
      endDate: "2026-07-06",
    });

    expect(
      sessions.filter((session) => session.subjectId === DEMO_IDS.dsp),
    ).toHaveLength(2);
  });

  it("resolves historical versions while retaining disabled and archived subjects", () => {
    const { demo, input } = context();
    const oldSlot = demo.timetableSlots.find(
      (slot) => slot.subjectId === DEMO_IDS.dsp && slot.dayOfWeek === "MONDAY",
    )!;
    const oldVersion = {
      ...demo.timetableVersion,
      effectiveEndDate: "2026-07-12",
    };
    const newVersion = {
      ...demo.timetableVersion,
      id: "00000000-0000-4000-8000-000000000099",
      version: 2,
      label: "Revised timetable",
      effectiveStartDate: "2026-07-13",
    };
    const newSlot: TimetableSlot = {
      ...oldSlot,
      id: "00000000-0000-4000-8000-000000000098",
      timetableVersionId: newVersion.id,
      startTime: "16:00",
      endTime: "17:00",
    };
    const subjects = demo.subjects.map((subject) =>
      subject.id === DEMO_IDS.dsp ? { ...subject, isEnabled: false } : subject,
    );
    const historicalInput = {
      ...input,
      subjects,
      timetableVersions: [oldVersion, newVersion],
      slots: [...demo.timetableSlots, newSlot],
      includeDisabled: true,
      includeMissingSubjects: true,
    };

    const oldSession = resolveSessionsForDate({
      ...historicalInput,
      date: "2026-07-06",
    }).find((candidate) => candidate.subjectId === DEMO_IDS.dsp);
    const revisedSession = resolveSessionsForDate({
      ...historicalInput,
      date: "2026-07-13",
    }).find((candidate) => candidate.subjectId === DEMO_IDS.dsp);

    expect(oldSession).toMatchObject({
      timetableVersionId: oldVersion.id,
      startTime: oldSlot.startTime,
    });
    expect(revisedSession).toMatchObject({
      timetableVersionId: newVersion.id,
      startTime: "16:00",
    });
    expect(
      resolveSessionsForDate({
        ...historicalInput,
        includeDisabled: false,
        date: "2026-07-13",
      }).some((candidate) => candidate.subjectId === DEMO_IDS.dsp),
    ).toBe(false);

    const archivedSubjectId = "00000000-0000-4000-8000-000000000097";
    const archivedSlot: TimetableSlot = {
      ...newSlot,
      id: "00000000-0000-4000-8000-000000000096",
      subjectId: archivedSubjectId,
      startTime: "17:00",
      endTime: "18:00",
    };
    expect(
      resolveSessionsForDate({
        ...historicalInput,
        slots: [...historicalInput.slots, archivedSlot],
        date: "2026-07-13",
      }).some((candidate) => candidate.subjectId === archivedSubjectId),
    ).toBe(true);
  });
});

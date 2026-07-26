import { describe, expect, it } from "vitest";

import { createDemoTimetable, DEMO_IDS } from "@/lib/demo";
import {
  detectDuplicateSlots,
  detectSlotConflicts,
  filterTimetableSlots,
  matchesCustomWeekPattern,
  matchesWeekPattern,
  resolveSessionsForDate,
  resolveTimetableVersionForDate,
} from "@/lib/timetable";
import type {
  ClassType,
  TimetableSlot,
  TimetableVersion,
} from "@/types/domain";

const allClassTypes: Record<ClassType, boolean> = {
  THEORY: true,
  LAB: true,
  TUTORIAL: true,
  SEMINAR: true,
  PROJECT: true,
  OTHER: true,
};

describe("timetable selection filtering", () => {
  it("includes only the selected elective alternatives", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: [DEMO_IDS.cmos, DEMO_IDS.microwave],
      selectedBatch: "A",
      trackedClassTypes: allClassTypes,
    });

    expect(
      slots.filter((slot) => slot.subjectId === DEMO_IDS.cmos),
    ).toHaveLength(3);
    expect(
      slots.filter((slot) => slot.subjectId === DEMO_IDS.microwave),
    ).toHaveLength(3);
    expect(
      slots.some((slot) => slot.subjectId === DEMO_IDS.opticalAlternative),
    ).toBe(false);
  });

  it("supports a user who selects no elective", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: [],
      selectedBatch: "A",
      trackedClassTypes: allClassTypes,
    });

    const electiveSubjectIds = new Set(
      demo.electiveGroups.flatMap((group) =>
        group.options.map((option) => option.subjectId),
      ),
    );
    expect(
      slots.some(
        (slot) => slot.subjectId && electiveSubjectIds.has(slot.subjectId),
      ),
    ).toBe(false);
    expect(slots.some((slot) => slot.subjectId === DEMO_IDS.dsp)).toBe(true);
  });

  it("includes only the selected batch lab", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedBatch: "A",
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
    }).filter((slot) => slot.subjectId === DEMO_IDS.dspLab);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.batchRestriction).toEqual(["A"]);
  });

  it("supports a user with no batch by excluding restricted alternatives", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedBatch: null,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
    });

    expect(slots.some((slot) => slot.batchRestriction.length > 0)).toBe(false);
    expect(slots.some((slot) => slot.subjectId === DEMO_IDS.dsp)).toBe(true);
  });

  it("removes labs when lab tracking is disabled", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedBatch: "A",
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: { ...allClassTypes, LAB: false },
    });

    expect(slots.some((slot) => slot.subjectId === DEMO_IDS.dspLab)).toBe(
      false,
    );
  });

  it("allows zero-credit subjects to be disabled independently", () => {
    const demo = createDemoTimetable();
    const included = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
      includeZeroCredit: true,
    });
    const excluded = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
      includeZeroCredit: false,
    });

    expect(
      included.some((slot) => slot.subjectId === DEMO_IDS.professionalEthics),
    ).toBe(true);
    expect(
      excluded.some((slot) => slot.subjectId === DEMO_IDS.professionalEthics),
    ).toBe(false);
  });

  it("ignores project placeholders even when projects are tracked", () => {
    const demo = createDemoTimetable();
    const slots = filterTimetableSlots({
      slots: demo.timetableSlots,
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
    });

    expect(slots.some((slot) => slot.subjectId === DEMO_IDS.miniProject)).toBe(
      false,
    );
  });
});

describe("version and recurrence resolution", () => {
  it("selects the timetable version effective on the requested date", () => {
    const demo = createDemoTimetable();
    const first: TimetableVersion = {
      ...demo.timetableVersion,
      effectiveEndDate: "2026-07-12",
    };
    const second: TimetableVersion = {
      ...demo.timetableVersion,
      id: "00000000-0000-4000-8000-000000000005",
      version: 2,
      label: "Second version",
      effectiveStartDate: "2026-07-13",
      effectiveEndDate: "2026-11-30",
    };

    expect(
      resolveTimetableVersionForDate([first, second], "2026-07-12")?.id,
    ).toBe(first.id);
    expect(
      resolveTimetableVersionForDate([first, second], "2026-07-13")?.id,
    ).toBe(second.id);
    expect(
      resolveTimetableVersionForDate([first, second], "2026-07-05"),
    ).toBeUndefined();
  });

  it("uses the correct version's slots when resolving dated sessions", () => {
    const demo = createDemoTimetable();
    const first: TimetableVersion = {
      ...demo.timetableVersion,
      effectiveEndDate: "2026-07-12",
    };
    const second: TimetableVersion = {
      ...demo.timetableVersion,
      id: "00000000-0000-4000-8000-000000000005",
      version: 2,
      label: "Second version",
      effectiveStartDate: "2026-07-13",
      effectiveEndDate: "2026-11-30",
    };
    const firstSlot = demo.timetableSlots.find((slot) =>
      slot.id.endsWith("000000000201"),
    );
    expect(firstSlot).toBeDefined();
    const secondSlot: TimetableSlot = {
      ...firstSlot!,
      id: "00000000-0000-4000-8000-000000000226",
      timetableVersionId: second.id,
      subjectId: DEMO_IDS.integratedCircuits,
    };
    const context = {
      semester: demo.semester,
      timetableVersions: [first, second],
      slots: [firstSlot!, secondSlot],
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      selectedElectiveSubjectIds: demo.selection.selectedElectiveSubjectIds,
      trackedClassTypes: allClassTypes,
    };

    expect(
      resolveSessionsForDate({ ...context, date: "2026-07-06" }).map(
        (session) => session.subjectId,
      ),
    ).toEqual([DEMO_IDS.dsp]);
    expect(
      resolveSessionsForDate({ ...context, date: "2026-07-13" }).map(
        (session) => session.subjectId,
      ),
    ).toEqual([DEMO_IDS.integratedCircuits]);
  });

  it("resolves odd and even academic weeks from the semester's first week", () => {
    const demo = createDemoTimetable();
    const odd: TimetableSlot = {
      ...demo.timetableSlots[0],
      weekPattern: "ODD_WEEK",
    };
    const even: TimetableSlot = {
      ...demo.timetableSlots[0],
      id: "00000000-0000-4000-8000-000000000226",
      startTime: "10:00",
      endTime: "11:00",
      weekPattern: "EVEN_WEEK",
    };

    expect(matchesWeekPattern(odd, "2026-07-06", demo.semester.startDate)).toBe(
      true,
    );
    expect(
      matchesWeekPattern(even, "2026-07-06", demo.semester.startDate),
    ).toBe(false);
    expect(matchesWeekPattern(odd, "2026-07-13", demo.semester.startDate)).toBe(
      false,
    );
    expect(
      matchesWeekPattern(even, "2026-07-13", demo.semester.startDate),
    ).toBe(true);
  });

  it("supports explicit weeks, cycle phases, and masks for custom recurrence", () => {
    expect(matchesCustomWeekPattern("weeks: 1, 3-4", 3)).toBe(true);
    expect(matchesCustomWeekPattern("weeks: 1, 3-4", 2)).toBe(false);
    expect(matchesCustomWeekPattern("2/3", 5)).toBe(true);
    expect(matchesCustomWeekPattern("1, 3 OF 4", 7)).toBe(true);
    expect(matchesCustomWeekPattern("1010", 4)).toBe(false);
  });
});

describe("manual timetable diagnostics", () => {
  it("detects exact duplicates separately from overlaps", () => {
    const demo = createDemoTimetable();
    const source = demo.timetableSlots[0];
    const duplicate: TimetableSlot = {
      ...source,
      id: "00000000-0000-4000-8000-000000000226",
    };
    const overlapping: TimetableSlot = {
      ...source,
      id: "00000000-0000-4000-8000-000000000227",
      subjectId: DEMO_IDS.integratedCircuits,
      startTime: "09:30",
      endTime: "10:30",
    };

    expect(detectDuplicateSlots([source, duplicate])).toHaveLength(1);
    expect(detectSlotConflicts([source, duplicate, overlapping])).toHaveLength(
      2,
    );
  });

  it("does not flag mutually exclusive batch or elective alternatives", () => {
    const demo = createDemoTimetable();
    const electiveAlternatives = demo.timetableSlots.filter(
      (slot) =>
        slot.dayOfWeek === "MONDAY" &&
        slot.electiveGroupId === DEMO_IDS.electiveOne,
    );
    const batchA: TimetableSlot = {
      ...demo.timetableSlots[0],
      id: "00000000-0000-4000-8000-000000000226",
      batchRestriction: ["A"],
    };
    const batchB: TimetableSlot = {
      ...batchA,
      id: "00000000-0000-4000-8000-000000000227",
      subjectId: DEMO_IDS.integratedCircuits,
      batchRestriction: ["B"],
    };

    expect(detectSlotConflicts(electiveAlternatives)).toEqual([]);
    expect(detectSlotConflicts([batchA, batchB])).toEqual([]);
  });

  it("does not flag odd- and even-week slots as overlapping", () => {
    const demo = createDemoTimetable();
    const oddWeek: TimetableSlot = {
      ...demo.timetableSlots[0],
      weekPattern: "ODD_WEEK",
    };
    const evenWeek: TimetableSlot = {
      ...oddWeek,
      id: "00000000-0000-4000-8000-000000000228",
      subjectId: DEMO_IDS.integratedCircuits,
      weekPattern: "EVEN_WEEK",
    };

    expect(detectSlotConflicts([oddWeek, evenWeek])).toEqual([]);
  });
});

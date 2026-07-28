import { describe, expect, it } from "vitest";
import {
  createPersonalTimetableDraft,
  normalizeSelectedGroups,
  resolveSelectedGroups,
} from "@/lib/timetable";
import type {
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types";

function subject(id: string): DraftSubject {
  return {
    temporaryId: id,
    name: id,
    shortName: id,
    credits: 3,
    classType: "THEORY",
    faculty: [],
    isZeroCredit: false,
    confidence: 1,
  };
}

function slot(
  id: string,
  subjectTemporaryId: string,
  dayOfWeek: DraftSlot["dayOfWeek"],
  batchOptions: string[] = [],
  confidence = 1,
): DraftSlot {
  return {
    temporaryId: id,
    subjectTemporaryId,
    dayOfWeek,
    startTime: "09:00",
    endTime: "10:00",
    faculty: [],
    classType: "THEORY",
    batchOptions,
    weekPattern: "EVERY_WEEK",
    confidence,
    isEnabled: true,
    isPlaceholder: false,
    isBreak: false,
  };
}

function draft(): NormalizedTimetableDraft {
  return {
    title: "Imported",
    timezone: "Asia/Kolkata",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"],
    timeSlots: [
      { startTime: "08:00", endTime: "09:00", label: "preserved input" },
    ],
    subjects: [
      subject("common"),
      subject("c4"),
      subject("g1"),
      subject("either"),
      subject("other"),
      subject("uncertain"),
    ],
    timetableSlots: [
      slot("common-slot", "common", "MONDAY"),
      slot("c4-slot", "c4", "TUESDAY", ["C4"]),
      slot("g1-slot", "g1", "WEDNESDAY", ["G1"]),
      slot("either-slot", "either", "THURSDAY", ["C4", "G1"]),
      slot("other-slot", "other", "FRIDAY", ["C2"]),
      slot("uncertain-slot", "uncertain", "SATURDAY", [], 0.4),
    ],
    detectedBatchOptions: ["C2", "C4", "G1"],
    detectedElectiveGroups: [
      {
        id: "empty-after-filter",
        name: "Alternative",
        options: [{ subjectTemporaryId: "other", label: "Other" }],
      },
    ],
    ambiguousItems: [],
    warnings: ["source warning"],
    overallConfidence: 0.8,
  };
}

describe("personal timetable draft", () => {
  it("uses union matching for multiple selected groups", () => {
    const original = draft();
    const personal = createPersonalTimetableDraft({
      draft: original,
      selectedGroups: [" c4 ", "G1"],
      selectedSlotIds: ["common-slot"],
    });

    expect(personal.timetableSlots.map((item) => item.temporaryId)).toEqual([
      "common-slot",
      "c4-slot",
      "g1-slot",
      "either-slot",
    ]);
    expect(personal.subjects.map((item) => item.temporaryId)).toEqual([
      "common",
      "c4",
      "g1",
      "either",
    ]);
    expect(personal.detectedElectiveGroups).toEqual([]);
    expect(personal.detectedBatchOptions).toEqual(["C4", "G1"]);
    expect(personal.days).toEqual([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
    ]);
    expect(original.timetableSlots).toHaveLength(6);
    expect(original.subjects).toHaveLength(6);
  });

  it("removes a deselected common class and keeps a selected uncertain class", () => {
    const personal = createPersonalTimetableDraft({
      draft: draft(),
      selectedGroups: [],
      selectedSlotIds: ["uncertain-slot"],
    });

    expect(personal.timetableSlots.map((item) => item.temporaryId)).toEqual([
      "uncertain-slot",
    ]);
    expect(personal.subjects.map((item) => item.temporaryId)).toEqual([
      "uncertain",
    ]);
  });

  it("keeps an individually deselected class out even when its group matches", () => {
    const personal = createPersonalTimetableDraft({
      draft: draft(),
      selectedGroups: ["C4"],
      selectedSlotIds: ["common-slot"],
      excludedSlotIds: ["c4-slot"],
    });

    expect(personal.timetableSlots.map((item) => item.temporaryId)).toEqual([
      "common-slot",
      "either-slot",
    ]);
  });

  it("normalises custom groups without replacing existing selections", () => {
    expect(normalizeSelectedGroups(["C4", " g1 ", "c4", "A   3"])).toEqual([
      "C4",
      "g1",
      "A 3",
    ]);
  });

  it("loads legacy singular batch selection when the array is absent", () => {
    expect(resolveSelectedGroups({ selectedBatch: "B1" })).toEqual(["B1"]);
    expect(
      resolveSelectedGroups({
        selectedBatch: "legacy",
        selectedBatches: ["C4", "G1"],
      }),
    ).toEqual(["C4", "G1"]);
  });

  it("keeps breaks as non-attendance slots without retaining their subject", () => {
    const original = draft();
    original.subjects.push(subject("lunch"));
    original.timetableSlots.push({
      ...slot("lunch-slot", "lunch", "MONDAY"),
      isBreak: true,
      electiveGroupId: "empty-after-filter",
    });

    const personal = createPersonalTimetableDraft({
      draft: original,
      selectedGroups: [],
      selectedSlotIds: ["common-slot"],
    });
    const lunch = personal.timetableSlots.find(
      (item) => item.temporaryId === "lunch-slot",
    );

    expect(lunch).toMatchObject({
      isBreak: true,
      subjectTemporaryId: undefined,
      electiveGroupId: undefined,
    });
    expect(personal.subjects.map((item) => item.temporaryId)).not.toContain(
      "lunch",
    );
  });
});

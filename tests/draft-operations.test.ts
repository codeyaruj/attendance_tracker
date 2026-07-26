import { describe, expect, it } from "vitest";

import {
  applyDraftSlotEdit,
  findDraftConflictSlotIds,
  mergeDuplicateSubjects,
  synchronizeDraftAlternatives,
} from "@/lib/timetable";
import type {
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types";

function subject(
  temporaryId: string,
  name: string,
  code?: string,
): DraftSubject {
  return {
    temporaryId,
    name,
    code,
    shortName: name.slice(0, 3).toUpperCase(),
    credits: 3,
    classType: "THEORY",
    faculty: [],
    isZeroCredit: false,
    confidence: 1,
  };
}

function slot(
  temporaryId: string,
  subjectTemporaryId = "subject-a",
): DraftSlot {
  return {
    temporaryId,
    subjectTemporaryId,
    dayOfWeek: "MONDAY",
    startTime: "09:00",
    endTime: "10:00",
    faculty: [],
    classType: "THEORY",
    batchOptions: [],
    weekPattern: "EVERY_WEEK",
    confidence: 1,
    isEnabled: true,
    isPlaceholder: false,
    isBreak: false,
  };
}

function draft(): NormalizedTimetableDraft {
  return {
    title: "Manual timetable",
    timezone: "Asia/Kolkata",
    days: ["MONDAY"],
    timeSlots: [{ startTime: "09:00", endTime: "10:00" }],
    subjects: [subject("subject-a", "Digital Signal Processing", "BEC501")],
    timetableSlots: [slot("slot-a")],
    detectedBatchOptions: [],
    detectedElectiveGroups: [],
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 1,
  };
}

describe("manual draft conveniences", () => {
  it("merges duplicate subjects deterministically and rewires slots and electives", () => {
    const value = draft();
    value.subjects = [
      { ...value.subjects[0], code: undefined, faculty: ["PJ"] },
      {
        ...subject("subject-b", " digital  signal processing ", "BEC501"),
        credits: 4,
        faculty: ["AK"],
      },
    ];
    value.timetableSlots.push(slot("slot-b", "subject-b"));
    value.detectedElectiveGroups = [
      {
        id: "Elective I",
        name: "Elective I",
        options: [
          { subjectTemporaryId: "subject-a", label: "DSP" },
          { subjectTemporaryId: "subject-b", label: "DSP duplicate" },
        ],
      },
    ];

    const result = mergeDuplicateSubjects(value);

    expect(result.mergedCount).toBe(1);
    expect(result.draft.subjects).toHaveLength(1);
    expect(result.draft.subjects[0]).toMatchObject({
      temporaryId: "subject-a",
      code: "BEC501",
      credits: 4,
      faculty: ["PJ", "AK"],
    });
    expect(
      result.draft.timetableSlots.every(
        (entry) => entry.subjectTemporaryId === "subject-a",
      ),
    ).toBe(true);
    expect(result.draft.detectedElectiveGroups[0].options).toEqual([
      { subjectTemporaryId: "subject-a", label: "DSP" },
    ]);
  });

  it("derives batch and elective metadata from manually saved slots", () => {
    const value = draft();
    value.timetableSlots = [
      {
        ...value.timetableSlots[0],
        batchOptions: ["B2"],
        electiveGroupId: "Open Elective",
      },
    ];

    const synchronized = synchronizeDraftAlternatives(value);

    expect(synchronized.detectedBatchOptions).toEqual(["B2"]);
    expect(synchronized.detectedElectiveGroups).toEqual([
      {
        id: "Open Elective",
        name: "Open Elective",
        allowMultiple: false,
        options: [
          {
            subjectTemporaryId: "subject-a",
            label: "Digital Signal Processing",
          },
        ],
      },
    ]);
  });

  it("flags real overlaps but permits mutually exclusive batch alternatives", () => {
    const first = slot("slot-a");
    const overlap = {
      ...slot("slot-b", "subject-b"),
      startTime: "09:30",
      endTime: "10:30",
    };
    expect(findDraftConflictSlotIds([first, overlap])).toEqual(
      new Set(["slot-a", "slot-b"]),
    );
    expect(
      findDraftConflictSlotIds([
        { ...first, batchOptions: ["B1"] },
        { ...overlap, batchOptions: ["B2"] },
      ]),
    ).toEqual(new Set());
  });

  it("edits only the selected recurring session by default", () => {
    const monday = slot("monday");
    const wednesday = {
      ...slot("wednesday"),
      dayOfWeek: "WEDNESDAY" as const,
      startTime: "13:00",
      endTime: "14:00",
    };
    const result = applyDraftSlotEdit(
      [monday, wednesday],
      monday,
      { ...monday, startTime: "10:00", endTime: "11:30", room: "A-12" },
      "ONE_SESSION",
    );

    expect(result.changedCount).toBe(1);
    expect(result.slots[0]).toMatchObject({ startTime: "10:00", room: "A-12" });
    expect(result.slots[1]).toEqual(wednesday);
  });

  it("shifts every subject session while preserving each weekday", () => {
    const monday = slot("monday");
    const mondayLater = {
      ...slot("monday-later"),
      startTime: "15:00",
      endTime: "16:00",
    };
    const wednesday = {
      ...slot("wednesday"),
      dayOfWeek: "WEDNESDAY" as const,
      startTime: "13:00",
      endTime: "14:00",
    };
    const unrelated = slot("unrelated", "subject-b");
    const result = applyDraftSlotEdit(
      [monday, mondayLater, wednesday, unrelated],
      monday,
      { ...monday, startTime: "10:00", endTime: "12:00", faculty: ["AK"] },
      "ALL_SUBJECT",
    );

    expect(result.changedCount).toBe(3);
    expect(
      result.slots.slice(0, 3).map(({ dayOfWeek, startTime, endTime }) => ({
        dayOfWeek,
        startTime,
        endTime,
      })),
    ).toEqual([
      { dayOfWeek: "MONDAY", startTime: "10:00", endTime: "12:00" },
      { dayOfWeek: "MONDAY", startTime: "16:00", endTime: "18:00" },
      { dayOfWeek: "WEDNESDAY", startTime: "14:00", endTime: "16:00" },
    ]);
    expect(result.slots[3]).toEqual(unrelated);
  });
});

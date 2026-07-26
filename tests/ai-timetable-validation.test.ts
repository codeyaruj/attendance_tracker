import { describe, expect, it } from "vitest";

import {
  AiTimetableValidationError,
  aiTimetableToDraft,
  validateAndNormaliseAiTimetable,
  type AiTimetable,
} from "@/lib/ai-timetable";

export function validAiTimetable(): AiTimetable {
  return {
    document: {
      institution: null,
      department: null,
      programme: null,
      semester: "Semester 5",
      section: null,
      room: null,
      academicYear: null,
    },
    timeSlots: [
      { startTime: "08:45", endTime: "10:45", sourceText: "Lab block" },
    ],
    subjects: [
      {
        code: " cse501 ",
        name: "Signals Lab",
        facultyCodes: ["AR"],
        facultyNames: ["Anita Rao"],
        room: "L2",
      },
    ],
    sessions: [
      {
        day: "Monday",
        startTime: "08:45",
        endTime: "10:45",
        subjectCode: " cse501 ",
        subjectName: "Signals Lab",
        facultyCodes: ["AR"],
        facultyNames: ["Anita Rao"],
        room: "L2",
        type: "lab",
        batchTags: ["C1C2"],
        electiveTags: ["BEC057"],
        sectionTags: ["A"],
        sourceText: "CSE501 LAB C1C2",
        confidence: 0.62,
        notes: null,
      },
    ],
    warnings: [],
  };
}

describe("AI timetable validation and mapping", () => {
  it("preserves a merged lab range and qualified editable session", () => {
    const draft = aiTimetableToDraft(validAiTimetable(), "Asia/Kolkata");
    expect(draft.timetableSlots[0]).toMatchObject({
      startTime: "08:45",
      endTime: "10:45",
      classType: "LAB",
      batchOptions: ["C1C2"],
    });
    expect(draft.timetableSlots[0]?.notes).toContain("Elective: BEC057");
    expect(draft.subjects[0]).toMatchObject({
      code: "CSE501",
      name: "Signals Lab",
    });
    expect(draft.ambiguousItems).toHaveLength(1);
    expect(draft.warnings[0]).toMatch(/low-confidence/i);
  });

  it("removes lunch and duplicates while retaining a warning", () => {
    const value = validAiTimetable();
    value.sessions.push({ ...value.sessions[0]! });
    value.sessions.push({
      ...value.sessions[0]!,
      subjectCode: null,
      subjectName: "Lunch",
      sourceText: "LUNCH",
    });
    const normalised = validateAndNormaliseAiTimetable(value);
    expect(normalised.sessions).toHaveLength(1);
    expect(normalised.warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("rejects invalid times and an empty usable timetable", () => {
    const value = validAiTimetable();
    value.sessions[0]!.startTime = "11:00";
    value.sessions[0]!.endTime = "10:00";
    expect(() => validateAndNormaliseAiTimetable(value)).toThrow(
      new AiTimetableValidationError("NO_TIMETABLE_DETECTED"),
    );
  });

  it("warns about implausible duration, overlaps, and unqualified alternatives", () => {
    const value = validAiTimetable();
    value.sessions[0]!.endTime = "16:00";
    value.sessions[0]!.sourceText = "BEC057/058";
    value.sessions[0]!.electiveTags = [];
    value.sessions.push({
      ...value.sessions[0]!,
      subjectCode: "CSE502",
      subjectName: "Overlapping Class",
      startTime: "10:00",
      endTime: "11:00",
      sourceText: "CSE502",
    });
    const warnings = validateAndNormaliseAiTimetable(value).warnings.join(" ");
    expect(warnings).toMatch(/longer than six hours/i);
    expect(warnings).toMatch(/elective alternative/i);
    expect(warnings).toMatch(/overlapping sessions/i);
  });
});

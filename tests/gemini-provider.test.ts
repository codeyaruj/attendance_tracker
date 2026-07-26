import { describe, expect, it } from "vitest";

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_TIMETABLE_JSON_SCHEMA,
  parseGeminiTimetableResponse,
  selectedGeminiModel,
} from "@/functions/api/timetable/gemini";
import { AiTimetableValidationError } from "@/lib/ai-timetable";

export function validGeminiResponse() {
  return {
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
        electiveTags: [],
        sectionTags: ["A"],
        sourceText: "CSE501 LAB C1C2",
        confidence: 0.92,
        notes: null,
      },
    ],
    warnings: [],
  };
}

describe("Gemini provider timetable contract", () => {
  it("uses a small handwritten schema and the current default model", () => {
    const schema = JSON.stringify(GEMINI_TIMETABLE_JSON_SCHEMA);
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash");
    expect(selectedGeminiModel()).toBe("gemini-3.5-flash");
    expect(selectedGeminiModel("custom-model")).toBe("custom-model");
    expect(schema).not.toMatch(
      /\$schema|additionalProperties|minLength|maxLength|maxItems|document|timeSlots|subjects/,
    );
  });

  it("converts simplified valid output into the complete validated shape", () => {
    const timetable = parseGeminiTimetableResponse(
      JSON.stringify(validGeminiResponse()),
    );
    expect(timetable.document).toEqual({
      institution: null,
      department: null,
      programme: null,
      semester: null,
      section: null,
      room: null,
      academicYear: null,
    });
    expect(timetable.subjects[0]).toMatchObject({
      code: "CSE501",
      name: "Signals Lab",
    });
    expect(timetable.timeSlots).toEqual([
      {
        startTime: "08:45",
        endTime: "10:45",
        sourceText: "CSE501 LAB C1C2",
      },
    ]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing sessions", JSON.stringify({ warnings: [] })],
    [
      "invalid weekday",
      JSON.stringify({
        ...validGeminiResponse(),
        sessions: [{ ...validGeminiResponse().sessions[0], day: "Funday" }],
      }),
    ],
  ])("rejects %s", (_label, response) => {
    expect(() => parseGeminiTimetableResponse(response)).toThrow(
      new AiTimetableValidationError("AI_INVALID_RESPONSE"),
    );
  });

  it.each([
    [
      "an invalid time range",
      {
        ...validGeminiResponse().sessions[0],
        startTime: "11:00",
        endTime: "10:00",
      },
    ],
    ["an empty timetable", undefined],
  ])("rejects %s after logical validation", (_label, session) => {
    const response = validGeminiResponse();
    response.sessions = session ? [session] : [];
    expect(() =>
      parseGeminiTimetableResponse(JSON.stringify(response)),
    ).toThrow(new AiTimetableValidationError("NO_TIMETABLE_DETECTED"));
  });
});

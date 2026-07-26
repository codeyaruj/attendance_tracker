import { z } from "zod";

import type { NormalizedTimetableDraft } from "@/types";
import type { ClassType, DayOfWeek } from "@/types/domain";
import {
  aiTimetableSchema,
  geminiTimetableResponseSchema,
  type AiTimetable,
} from "./schema";

const DAYS: Record<AiTimetable["sessions"][number]["day"], DayOfWeek> = {
  Monday: "MONDAY",
  Tuesday: "TUESDAY",
  Wednesday: "WEDNESDAY",
  Thursday: "THURSDAY",
  Friday: "FRIDAY",
  Saturday: "SATURDAY",
  Sunday: "SUNDAY",
};
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function timeInMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export class AiTimetableValidationError extends Error {
  constructor(readonly code: "AI_INVALID_RESPONSE" | "NO_TIMETABLE_DETECTED") {
    super(
      code === "NO_TIMETABLE_DETECTED"
        ? "No usable timetable was detected in this image."
        : "The AI response did not contain a valid timetable.",
    );
  }
}

function normaliseCode(value: string | null): string | undefined {
  return value?.trim().replace(/\s+/g, " ").toUpperCase() || undefined;
}

export function geminiResponseToAiTimetable(input: unknown): AiTimetable {
  const result = geminiTimetableResponseSchema.safeParse(input);
  if (!result.success) {
    throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
  }
  const subjects = [
    ...new Map(
      result.data.sessions.map((session) => {
        const code = normaliseCode(session.subjectCode) ?? null;
        const key = code ?? session.subjectName.toLowerCase();
        return [
          key,
          {
            code,
            name: session.subjectName,
            facultyCodes: session.facultyCodes,
            facultyNames: session.facultyNames,
            room: session.room,
          },
        ];
      }),
    ).values(),
  ];
  const timeSlots = [
    ...new Map(
      result.data.sessions.map((session) => [
        `${session.startTime}-${session.endTime}`,
        {
          startTime: session.startTime,
          endTime: session.endTime,
          sourceText: session.sourceText,
        },
      ]),
    ).values(),
  ];
  return validateAndNormaliseAiTimetable({
    document: {
      institution: null,
      department: null,
      programme: null,
      semester: null,
      section: null,
      room: null,
      academicYear: null,
    },
    subjects,
    timeSlots,
    sessions: result.data.sessions,
    warnings: result.data.warnings,
  });
}

export function validateAndNormaliseAiTimetable(input: unknown): AiTimetable {
  let parsed: AiTimetable;
  try {
    parsed = aiTimetableSchema.parse(input);
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
    }
    throw cause;
  }

  const warnings = new Set(parsed.warnings);
  const seen = new Set<string>();
  const sessions = parsed.sessions.flatMap((session) => {
    const subjectName = session.subjectName.trim();
    const source = `${session.sourceText ?? ""} ${subjectName}`.toLowerCase();
    if (/\b(?:lunch|break|recess)\b/.test(source)) return [];
    if (!TIME.test(session.startTime) || !TIME.test(session.endTime)) {
      warnings.add(`Ignored ${subjectName}: invalid time format.`);
      return [];
    }
    if (session.startTime >= session.endTime) {
      warnings.add(`Ignored ${subjectName}: end time must follow start time.`);
      return [];
    }
    if (
      timeInMinutes(session.endTime) - timeInMinutes(session.startTime) >
      6 * 60
    ) {
      warnings.add(
        `Review ${subjectName}: the detected session is longer than six hours.`,
      );
    }
    if (
      session.electiveTags.length === 0 &&
      /\b[A-Z]{2,}\d+\s*\/\s*[A-Z0-9]+\b/i.test(session.sourceText ?? "")
    ) {
      warnings.add(
        `Review ${subjectName}: a possible elective alternative has no qualifier.`,
      );
    }
    const key = [
      session.day,
      session.startTime,
      session.endTime,
      normaliseCode(session.subjectCode) ?? subjectName.toLowerCase(),
      [...session.batchTags].sort().join("|"),
      [...session.electiveTags].sort().join("|"),
    ].join("::");
    if (seen.has(key)) {
      warnings.add(
        `Removed duplicate ${subjectName} session on ${session.day}.`,
      );
      return [];
    }
    seen.add(key);
    if (session.confidence < 0.7) {
      warnings.add(
        `Review the low-confidence ${subjectName} session on ${session.day}.`,
      );
    }
    return [
      { ...session, subjectCode: normaliseCode(session.subjectCode) ?? null },
    ];
  });
  if (sessions.length === 0) {
    throw new AiTimetableValidationError("NO_TIMETABLE_DETECTED");
  }
  for (let index = 0; index < sessions.length; index += 1) {
    const left = sessions[index]!;
    for (
      let otherIndex = index + 1;
      otherIndex < sessions.length;
      otherIndex += 1
    ) {
      const right = sessions[otherIndex]!;
      if (
        left.day === right.day &&
        left.startTime < right.endTime &&
        right.startTime < left.endTime
      ) {
        warnings.add(
          `Review overlapping sessions on ${left.day}: ${left.subjectName} and ${right.subjectName}.`,
        );
      }
    }
  }
  return { ...parsed, sessions, warnings: [...warnings] };
}

function classType(type: AiTimetable["sessions"][number]["type"]): ClassType {
  if (type === "lab") return "LAB";
  if (type === "tutorial") return "TUTORIAL";
  if (type === "project") return "PROJECT";
  return "THEORY";
}

export function aiTimetableToDraft(
  input: AiTimetable,
  timezone: string,
): NormalizedTimetableDraft {
  const timetable = validateAndNormaliseAiTimetable(input);
  const subjectKeys = new Map<string, string>();
  const subjects: NormalizedTimetableDraft["subjects"] = [];
  for (const session of timetable.sessions) {
    const key = session.subjectCode ?? session.subjectName.toLowerCase();
    if (subjectKeys.has(key)) continue;
    const legend = timetable.subjects.find(
      (subject) =>
        (session.subjectCode &&
          normaliseCode(subject.code) === session.subjectCode) ||
        subject.name.toLowerCase() === session.subjectName.toLowerCase(),
    );
    const temporaryId = crypto.randomUUID();
    subjectKeys.set(key, temporaryId);
    const name = legend?.name ?? session.subjectName;
    subjects.push({
      temporaryId,
      code: session.subjectCode ?? undefined,
      name,
      shortName: session.subjectCode ?? name.slice(0, 12),
      credits: 0,
      classType: classType(session.type),
      faculty: [...new Set([...session.facultyNames, ...session.facultyCodes])],
      isZeroCredit: false,
      confidence: session.confidence,
    });
  }
  const timetableSlots = timetable.sessions.map((session) => {
    const qualifiers = [
      session.electiveTags.length
        ? `Elective: ${session.electiveTags.join(", ")}`
        : "",
      session.sectionTags.length
        ? `Section: ${session.sectionTags.join(", ")}`
        : "",
      session.notes ?? "",
    ].filter(Boolean);
    return {
      temporaryId: crypto.randomUUID(),
      subjectTemporaryId: subjectKeys.get(
        session.subjectCode ?? session.subjectName.toLowerCase(),
      ),
      dayOfWeek: DAYS[session.day],
      startTime: session.startTime,
      endTime: session.endTime,
      faculty: [...new Set([...session.facultyNames, ...session.facultyCodes])],
      room: session.room ?? undefined,
      classType: classType(session.type),
      batchOptions: session.batchTags,
      weekPattern: "EVERY_WEEK" as const,
      notes: qualifiers.join(" · ") || undefined,
      confidence: session.confidence,
      isEnabled: true,
      isPlaceholder: false,
      isBreak: false,
    };
  });
  const days = [...new Set(timetableSlots.map((slot) => slot.dayOfWeek))];
  const timeSlots = [
    ...new Map(
      timetableSlots.map((slot) => [
        `${slot.startTime}-${slot.endTime}`,
        { startTime: slot.startTime, endTime: slot.endTime },
      ]),
    ).values(),
  ].sort((left, right) => left.startTime.localeCompare(right.startTime));
  return {
    title: timetable.document.semester ?? "AI-assisted timetable",
    timezone,
    days,
    timeSlots,
    subjects,
    timetableSlots,
    detectedBatchOptions: [
      ...new Set(timetable.sessions.flatMap((session) => session.batchTags)),
    ],
    detectedElectiveGroups: [],
    ambiguousItems: timetable.sessions
      .filter((session) => session.confidence < 0.7)
      .map((session) => ({
        id: crypto.randomUUID(),
        field: "session",
        possibleValues: [session.subjectName],
        sourceDescription:
          session.sourceText ?? `${session.day} ${session.startTime}`,
        confidence: session.confidence,
      })),
    warnings: timetable.warnings,
    overallConfidence:
      timetable.sessions.reduce((sum, session) => sum + session.confidence, 0) /
      timetable.sessions.length,
  };
}

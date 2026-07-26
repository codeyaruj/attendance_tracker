import { GoogleGenAI } from "@google/genai";

import {
  AI_TIMETABLE_LIMITS,
  type AiTimetable,
  type LocalExtractionHints,
} from "../../../lib/ai-timetable/schema";
import {
  AiTimetableValidationError,
  geminiResponseToAiTimetable,
} from "../../../lib/ai-timetable/validation";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

const nullableString = (description: string) => ({
  type: ["string", "null"],
  description,
});

const stringArray = (description: string) => ({
  type: "array",
  description,
  items: { type: "string" },
});

export const GEMINI_TIMETABLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    sessions: {
      type: "array",
      description: "Recurring timetable sessions found in the weekly grid.",
      items: {
        type: "object",
        properties: {
          day: {
            type: "string",
            enum: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ],
            description: "Full English weekday name.",
          },
          startTime: {
            type: "string",
            description: "Session start in HH:mm 24-hour format.",
          },
          endTime: {
            type: "string",
            description: "Session end in HH:mm 24-hour format.",
          },
          subjectCode: nullableString(
            "Subject code when visible, otherwise null.",
          ),
          subjectName: {
            type: "string",
            description: "Subject name or the best visible non-invented label.",
          },
          facultyCodes: stringArray("Visible faculty abbreviations."),
          facultyNames: stringArray(
            "Expanded faculty names when supported by the image.",
          ),
          room: nullableString("Room when visible, otherwise null."),
          type: {
            type: "string",
            enum: [
              "lecture",
              "lab",
              "tutorial",
              "project",
              "assessment",
              "other",
            ],
            description: "Class type supported by the source.",
          },
          batchTags: stringArray("Batch qualifiers for this session."),
          electiveTags: stringArray("Elective qualifiers for this session."),
          sectionTags: stringArray("Section qualifiers for this session."),
          sourceText: nullableString(
            "Relevant cell text when visible, otherwise null.",
          ),
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence in this extracted session from 0 to 1.",
          },
          notes: nullableString(
            "Short uncertainty note when needed, otherwise null.",
          ),
        },
        required: [
          "day",
          "startTime",
          "endTime",
          "subjectCode",
          "subjectName",
          "facultyCodes",
          "facultyNames",
          "room",
          "type",
          "batchTags",
          "electiveTags",
          "sectionTags",
          "sourceText",
          "confidence",
          "notes",
        ],
      },
    },
    warnings: stringArray("Document-level extraction uncertainties."),
  },
  required: ["sessions", "warnings"],
} as const;

export const TIMETABLE_PROMPT = `Read the selected weekly timetable image and return only the requested JSON structure.
Identify the timetable grid, not headings, logos, signatures, subject legends, or faculty tables. Use legends only to enrich subject and faculty metadata. Ignore lunch, break, blank, and decorative coloured cells. Preserve merged-cell duration: for example, a lab spanning 08:45–10:45 is one session covering the full range. A vertical LUNCH cell creates no session. Split mutually exclusive batch or elective alternatives into separately qualified sessions; never flatten them into unconditional classes. Preserve section, batch, and elective tags. Normalise weekdays to full English names and times to HH:mm 24-hour format. Never invent missing names, faculty, rooms, or sessions. Keep uncertain source text, assign confidence honestly, and add warnings. Return no session when evidence is insufficient.`;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function selectedGeminiModel(model?: string): string {
  return model?.trim() || DEFAULT_GEMINI_MODEL;
}

export function parseGeminiTimetableResponse(
  text: string | undefined,
): AiTimetable {
  if (!text) {
    throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
  }
  return geminiResponseToAiTimetable(parsed);
}

export async function analyseWithGemini(input: {
  apiKey: string;
  model?: string;
  image: File;
  hints?: LocalExtractionHints;
}): Promise<AiTimetable> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AI_TIMETABLE_LIMITS.timeoutMs,
  );
  try {
    const image = bytesToBase64(
      new Uint8Array(await input.image.arrayBuffer()),
    );
    const ai = new GoogleGenAI({ apiKey: input.apiKey });
    const response = await ai.models.generateContent({
      model: selectedGeminiModel(input.model),
      contents: [
        {
          role: "user",
          parts: [
            { text: TIMETABLE_PROMPT },
            ...(input.hints
              ? [
                  {
                    text: `Limited local extraction hints:\n${JSON.stringify(input.hints)}`,
                  },
                ]
              : []),
            { inlineData: { mimeType: input.image.type, data: image } },
          ],
        },
      ],
      config: {
        abortSignal: controller.signal,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseJsonSchema: GEMINI_TIMETABLE_JSON_SCHEMA,
      },
    });
    return parseGeminiTimetableResponse(response.text);
  } finally {
    clearTimeout(timeout);
  }
}

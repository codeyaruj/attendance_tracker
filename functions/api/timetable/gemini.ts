import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  AI_TIMETABLE_LIMITS,
  aiTimetableSchema,
  type AiTimetable,
  type LocalExtractionHints,
} from "../../../lib/ai-timetable/schema";
import { AiTimetableValidationError } from "../../../lib/ai-timetable/validation";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

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
      model: input.model || DEFAULT_GEMINI_MODEL,
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
        responseJsonSchema: z.toJSONSchema(aiTimetableSchema),
      },
    });
    if (!response.text) {
      throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
    }
    try {
      return JSON.parse(response.text) as AiTimetable;
    } catch {
      throw new AiTimetableValidationError("AI_INVALID_RESPONSE");
    }
  } finally {
    clearTimeout(timeout);
  }
}

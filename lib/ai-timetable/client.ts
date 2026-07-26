import {
  AI_TIMETABLE_LIMITS,
  aiResponseSchema,
  localExtractionHintsSchema,
  type AiErrorCode,
  type LocalExtractionHints,
} from "./schema";
import { validateAndNormaliseAiTimetable } from "./validation";

export class AiTimetableRequestError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiTimetableRequestError";
  }
}

export async function requestAiTimetable(
  image: File,
  hints: LocalExtractionHints | undefined,
  signal?: AbortSignal,
) {
  if (image.size > AI_TIMETABLE_LIMITS.maximumImageBytes) {
    throw new AiTimetableRequestError(
      "IMAGE_TOO_LARGE",
      "Choose an image no larger than 8 MB for AI analysis.",
    );
  }
  const form = new FormData();
  form.set("image", image);
  if (hints)
    form.set(
      "localHints",
      JSON.stringify(localExtractionHintsSchema.parse(hints)),
    );
  let response: Response;
  try {
    response = await fetch("/api/timetable/analyse", {
      method: "POST",
      body: form,
      signal,
      credentials: "same-origin",
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new AiTimetableRequestError(
      "AI_PROVIDER_ERROR",
      "AI schedule analysis is temporarily unavailable.",
    );
  }
  const parsed = aiResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    throw new AiTimetableRequestError(
      "AI_INVALID_RESPONSE",
      "The AI service returned an invalid response.",
    );
  }
  if (!parsed.data.ok) {
    throw new AiTimetableRequestError(
      parsed.data.error.code,
      parsed.data.error.message,
    );
  }
  return validateAndNormaliseAiTimetable(parsed.data.data);
}

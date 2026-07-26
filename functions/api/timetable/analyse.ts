import {
  AI_TIMETABLE_IMAGE_TYPES,
  AI_TIMETABLE_LIMITS,
  localExtractionHintsSchema,
  type AiErrorCode,
  type AiTimetable,
  type LocalExtractionHints,
} from "../../../lib/ai-timetable/schema";
import {
  AiTimetableValidationError,
  validateAndNormaliseAiTimetable,
} from "../../../lib/ai-timetable/validation";
import { analyseWithGemini } from "./gemini";

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export type TimetableAiProvider = (input: {
  apiKey: string;
  model?: string;
  image: File;
  hints?: LocalExtractionHints;
}) => Promise<AiTimetable>;

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function failure(code: AiErrorCode, message: string, status: number): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers },
  );
}

function safeProviderError(cause: unknown): Response {
  if (cause instanceof AiTimetableValidationError) {
    return failure(cause.code, cause.message, 422);
  }
  const errorName =
    typeof cause === "object" && cause !== null && "name" in cause
      ? String(Reflect.get(cause, "name"))
      : undefined;
  if (errorName === "AbortError" || errorName === "TimeoutError") {
    return failure(
      "AI_TIMEOUT",
      "AI schedule analysis timed out. Try again later.",
      504,
    );
  }
  const status =
    typeof cause === "object" && cause !== null && "status" in cause
      ? Number(Reflect.get(cause, "status"))
      : undefined;
  if (status === 429) {
    return failure(
      "AI_RATE_LIMITED",
      "AI schedule analysis is busy. Try again later.",
      429,
    );
  }
  return failure(
    "AI_PROVIDER_ERROR",
    "AI schedule analysis is temporarily unavailable.",
    502,
  );
}

export function createTimetableAnalysisHandler(provider: TimetableAiProvider) {
  return async (context: PagesContext): Promise<Response> => {
    const { request } = context;
    if (request.method !== "POST") {
      const response = failure(
        "METHOD_NOT_ALLOWED",
        "Use POST for timetable analysis.",
        405,
      );
      response.headers.set("Allow", "POST");
      return response;
    }
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) {
      return failure(
        "INVALID_CONTENT_TYPE",
        "Cross-origin requests are not accepted.",
        403,
      );
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data")
    ) {
      return failure(
        "INVALID_CONTENT_TYPE",
        "Upload the timetable as multipart form data.",
        415,
      );
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return failure(
        "INVALID_CONTENT_TYPE",
        "The upload form could not be read.",
        400,
      );
    }
    if (
      [...form.keys()].some((key) => key !== "image" && key !== "localHints")
    ) {
      return failure(
        "INVALID_HINTS",
        "The request contains unsupported fields.",
        400,
      );
    }
    if (
      form.getAll("image").length > 1 ||
      form.getAll("localHints").length > 1
    ) {
      return failure(
        "INVALID_HINTS",
        "The request contains duplicate upload fields.",
        400,
      );
    }
    const image = form.get("image");
    const isFile =
      typeof image === "object" &&
      image !== null &&
      typeof Reflect.get(image, "name") === "string" &&
      typeof Reflect.get(image, "type") === "string" &&
      typeof Reflect.get(image, "size") === "number" &&
      typeof Reflect.get(image, "arrayBuffer") === "function";
    if (!isFile || Reflect.get(image, "size") === 0) {
      return failure(
        "MISSING_IMAGE",
        "Select a timetable image to analyse.",
        400,
      );
    }
    const file = image as File;
    if (!(AI_TIMETABLE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      return failure(
        "UNSUPPORTED_IMAGE_TYPE",
        "Use a JPEG, PNG, or WebP image.",
        415,
      );
    }
    if (file.size > AI_TIMETABLE_LIMITS.maximumImageBytes) {
      return failure(
        "IMAGE_TOO_LARGE",
        "Choose an image no larger than 8 MB.",
        413,
      );
    }
    let hints: LocalExtractionHints | undefined;
    const rawHints = form.get("localHints");
    if (rawHints !== null) {
      if (
        typeof rawHints !== "string" ||
        new TextEncoder().encode(rawHints).length >
          AI_TIMETABLE_LIMITS.maximumHintsBytes
      ) {
        return failure(
          "INVALID_HINTS",
          "Local extraction hints are invalid.",
          400,
        );
      }
      try {
        hints = localExtractionHintsSchema.parse(JSON.parse(rawHints));
      } catch {
        return failure(
          "INVALID_HINTS",
          "Local extraction hints are invalid.",
          400,
        );
      }
    }
    if (!context.env.GEMINI_API_KEY) {
      return failure(
        "AI_NOT_CONFIGURED",
        "AI schedule analysis is not configured.",
        503,
      );
    }
    try {
      const data = validateAndNormaliseAiTimetable(
        await provider({
          apiKey: context.env.GEMINI_API_KEY,
          model: context.env.GEMINI_MODEL,
          image: file,
          hints,
        }),
      );
      return Response.json({ ok: true, data }, { status: 200, headers });
    } catch (cause) {
      return safeProviderError(cause);
    }
  };
}

export const onRequest = createTimetableAnalysisHandler(analyseWithGemini);

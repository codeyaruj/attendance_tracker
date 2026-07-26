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
import { analyseWithGemini, selectedGeminiModel } from "./gemini";

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

interface ProviderErrorDetails {
  name?: string;
  status?: number;
  code?: string;
  message: string;
}

function nestedValue(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

function httpStatus(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : undefined;
}

export function providerErrorDetails(cause: unknown): ProviderErrorDetails {
  const statusCandidates = [
    nestedValue(cause, "status"),
    nestedValue(cause, "code"),
    nestedValue(cause, "response", "status"),
    nestedValue(cause, "error", "code"),
    nestedValue(cause, "error", "status"),
  ];
  const status = statusCandidates.map(httpStatus).find(Boolean);
  const rawCode =
    nestedValue(cause, "error", "code") ??
    nestedValue(cause, "code") ??
    nestedValue(cause, "error", "status");
  const code =
    rawCode !== undefined && httpStatus(rawCode) === undefined
      ? String(rawCode).slice(0, 100)
      : undefined;
  const rawMessage =
    nestedValue(cause, "message") ??
    nestedValue(cause, "error", "message") ??
    "Gemini request failed.";
  return {
    name:
      nestedValue(cause, "name") !== undefined
        ? String(nestedValue(cause, "name")).slice(0, 100)
        : undefined,
    status,
    code,
    message: String(rawMessage),
  };
}

function diagnosticMessage(
  message: string,
  sensitiveValues: Array<string | undefined>,
): string {
  let safe = message;
  for (const value of sensitiveValues) {
    if (value) safe = safe.split(value).join("[redacted]");
  }
  return safe
    .replace(/\b(?:AIza|AQ\.)[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "[redacted]")
    .slice(0, 500);
}

function isLocalPagesRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function localDiagnosticSecrets(input: {
  apiKey: string;
  image: File;
  rawHints: FormDataEntryValue | null;
  hints?: LocalExtractionHints;
}): Array<string | undefined> {
  return [
    input.apiKey,
    input.image.name,
    typeof input.rawHints === "string" ? input.rawHints : undefined,
    input.hints?.rawText,
    ...((input.hints?.warnings ?? []) as string[]),
    ...(input.hints?.detectedTimes ?? []).flatMap((time) => [
      time.rawText,
      time.startTime,
      time.endTime,
    ]),
  ];
}

function logLocalProviderFailure(input: {
  request: Request;
  model: string;
  elapsedMs: number;
  cause: unknown;
  sensitiveValues: Array<string | undefined>;
}): void {
  if (!isLocalPagesRequest(input.request)) return;
  const details = providerErrorDetails(input.cause);
  console.error("[ai-timetable] Gemini request failed", {
    model: input.model,
    elapsedMs: input.elapsedMs,
    name: details.name,
    status: details.status,
    code: details.code,
    message: diagnosticMessage(details.message, input.sensitiveValues),
  });
}

function safeProviderError(cause: unknown): Response {
  if (cause instanceof AiTimetableValidationError) {
    return failure(cause.code, cause.message, 422);
  }
  const details = providerErrorDetails(cause);
  if (
    details.name === "AbortError" ||
    details.name === "TimeoutError" ||
    details.status === 504 ||
    details.code === "DEADLINE_EXCEEDED"
  ) {
    return failure(
      "AI_TIMEOUT",
      "AI schedule analysis timed out. Try again later.",
      504,
    );
  }
  if (details.status === 429 || details.code === "RESOURCE_EXHAUSTED") {
    return failure(
      "AI_RATE_LIMITED",
      "AI schedule analysis is busy. Try again later.",
      429,
    );
  }
  if (details.status === 400 || details.code === "INVALID_ARGUMENT") {
    return failure(
      "AI_INVALID_RESPONSE",
      "The AI request was rejected. Try another image or enter the timetable manually.",
      422,
    );
  }
  if (details.status === 401 || details.status === 403) {
    return failure(
      "AI_PROVIDER_ERROR",
      "AI schedule analysis is unavailable because its server configuration was rejected.",
      502,
    );
  }
  if (details.status === 404) {
    return failure(
      "AI_PROVIDER_ERROR",
      "The configured AI model is currently unavailable.",
      502,
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
    const model = selectedGeminiModel(context.env.GEMINI_MODEL);
    const startedAt = Date.now();
    try {
      const data = validateAndNormaliseAiTimetable(
        await provider({
          apiKey: context.env.GEMINI_API_KEY,
          model,
          image: file,
          hints,
        }),
      );
      return Response.json({ ok: true, data }, { status: 200, headers });
    } catch (cause) {
      logLocalProviderFailure({
        request,
        model,
        elapsedMs: Date.now() - startedAt,
        cause,
        sensitiveValues: localDiagnosticSecrets({
          apiKey: context.env.GEMINI_API_KEY,
          image: file,
          rawHints,
          hints,
        }),
      });
      return safeProviderError(cause);
    }
  };
}

export const onRequest = createTimetableAnalysisHandler(analyseWithGemini);

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

export const GEMINI_RETRY_POLICY = {
  maximumPrimaryAttempts: 3,
  maximumFallbackAttempts: 1,
  maximumTotalAttempts: 4,
  retryDelaysMs: [400, 1_000],
  maximumJitterMs: 100,
  minimumAttemptBudgetMs: 1_500,
} as const;

interface GeminiAttemptInput {
  model: string;
  signal: AbortSignal;
}

interface GeminiAttemptResult {
  text?: string;
}

interface GeminiRetryLogger {
  info(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
  error(message: string, details: Record<string, unknown>): void;
}

export interface GeminiRuntimeOptions {
  generateContent?: (input: GeminiAttemptInput) => Promise<GeminiAttemptResult>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  deadlineMs?: number;
  logger?: GeminiRetryLogger;
}

interface GeminiFailureDetails {
  status?: number;
  providerStatus?: string;
  retryable: boolean;
}

export class GeminiProviderError extends Error {
  readonly status?: number;
  readonly providerStatus?: string;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly model: string;
  readonly fallbackUsed: boolean;
  readonly deadlineExceeded: boolean;

  constructor(input: {
    status?: number;
    providerStatus?: string;
    retryable: boolean;
    attempts: number;
    model: string;
    fallbackUsed: boolean;
    deadlineExceeded?: boolean;
    cause: unknown;
  }) {
    const status = input.status ? ` HTTP ${input.status}` : "";
    const providerStatus = input.providerStatus
      ? ` ${input.providerStatus}`
      : "";
    super(`Gemini request failed${status}${providerStatus}.`, {
      cause: input.cause,
    });
    this.name = "GeminiProviderError";
    this.status = input.status;
    this.providerStatus = input.providerStatus;
    this.retryable = input.retryable;
    this.attempts = input.attempts;
    this.model = input.model;
    this.fallbackUsed = input.fallbackUsed;
    this.deadlineExceeded = input.deadlineExceeded ?? false;
  }
}

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

function numericStatus(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : undefined;
}

function providerStatusFromMessage(message: unknown): string | undefined {
  if (typeof message !== "string" || message.length > 2_000) return undefined;
  try {
    const parsed: unknown = JSON.parse(message);
    const status = nestedValue(parsed, "error", "status");
    return typeof status === "string" ? status.slice(0, 100) : undefined;
  } catch {
    return undefined;
  }
}

function failureDetails(cause: unknown): GeminiFailureDetails {
  const status = [
    nestedValue(cause, "status"),
    nestedValue(cause, "code"),
    nestedValue(cause, "response", "status"),
    nestedValue(cause, "error", "code"),
    nestedValue(cause, "error", "status"),
  ]
    .map(numericStatus)
    .find((candidate) => candidate !== undefined);
  const rawProviderStatus =
    nestedValue(cause, "providerStatus") ??
    nestedValue(cause, "error", "status") ??
    providerStatusFromMessage(nestedValue(cause, "message"));
  const providerStatus =
    typeof rawProviderStatus === "string" &&
    numericStatus(rawProviderStatus) === undefined
      ? rawProviderStatus.slice(0, 100).toUpperCase()
      : undefined;
  const name = String(nestedValue(cause, "name") ?? "");
  const message = String(nestedValue(cause, "message") ?? "");
  const networkFailure =
    name === "TypeError" &&
    /fetch|network|socket|connection|econn|timed?\s*out/i.test(message);
  return {
    status,
    providerStatus,
    retryable:
      status === 429 ||
      status === 503 ||
      providerStatus === "RESOURCE_EXHAUSTED" ||
      providerStatus === "UNAVAILABLE" ||
      networkFailure,
  };
}

function isAbort(cause: unknown): boolean {
  const name = nestedValue(cause, "name");
  return name === "AbortError" || name === "TimeoutError";
}

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const completed = () => {
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const timer = setTimeout(completed, milliseconds);
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    void Promise.resolve().then(() => {
      if (!signal.aborted) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
    });
  });
}

function retryDelay(retryIndex: number, random: () => number): number {
  const base = GEMINI_RETRY_POLICY.retryDelaysMs[retryIndex] ?? 1_000;
  return base + Math.floor(random() * GEMINI_RETRY_POLICY.maximumJitterMs);
}

function attemptLog(input: {
  requestId: string;
  model: string;
  attempt: number;
  durationMs: number;
  failure?: GeminiFailureDetails;
  fallbackUsed: boolean;
  outcome: "succeeded" | "retrying" | "failed";
}) {
  return {
    requestId: input.requestId,
    model: input.model,
    attempt: input.attempt,
    maximumAttempts: GEMINI_RETRY_POLICY.maximumTotalAttempts,
    durationMs: input.durationMs,
    status: input.failure?.status,
    providerStatus: input.failure?.providerStatus,
    retryable: input.failure?.retryable ?? false,
    fallbackUsed: input.fallbackUsed,
    outcome: input.outcome,
  };
}

export async function analyseWithGemini(
  input: {
    apiKey: string;
    model?: string;
    fallbackModel?: string;
    image: File;
    hints?: LocalExtractionHints;
    signal?: AbortSignal;
    requestId?: string;
  },
  runtime: GeminiRuntimeOptions = {},
): Promise<AiTimetable> {
  const now = runtime.now ?? Date.now;
  const random = runtime.random ?? Math.random;
  const sleep = runtime.sleep ?? waitForRetry;
  const logger = runtime.logger ?? console;
  const deadlineMs = runtime.deadlineMs ?? AI_TIMETABLE_LIMITS.timeoutMs;
  const deadlineAt = now() + deadlineMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException("Gemini deadline exceeded", "TimeoutError"),
    );
  }, deadlineMs);
  const parentAborted = () =>
    controller.abort(
      input.signal?.reason ?? new DOMException("Aborted", "AbortError"),
    );
  if (input.signal?.aborted) parentAborted();
  else input.signal?.addEventListener("abort", parentAborted, { once: true });
  try {
    const image = bytesToBase64(
      new Uint8Array(await input.image.arrayBuffer()),
    );
    const ai = new GoogleGenAI({ apiKey: input.apiKey });
    const generateContent =
      runtime.generateContent ??
      (async ({ model, signal }: GeminiAttemptInput) =>
        ai.models.generateContent({
          model,
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
            abortSignal: signal,
            temperature: 0.1,
            responseMimeType: "application/json",
            responseJsonSchema: GEMINI_TIMETABLE_JSON_SCHEMA,
          },
        }));
    const primaryModel = selectedGeminiModel(input.model);
    const configuredFallback = input.fallbackModel?.trim();
    const fallbackModel =
      configuredFallback && configuredFallback !== primaryModel
        ? configuredFallback
        : undefined;
    const models = [
      {
        model: primaryModel,
        maximumAttempts: GEMINI_RETRY_POLICY.maximumPrimaryAttempts,
        fallbackUsed: false,
      },
      ...(fallbackModel
        ? [
            {
              model: fallbackModel,
              maximumAttempts: GEMINI_RETRY_POLICY.maximumFallbackAttempts,
              fallbackUsed: true,
            },
          ]
        : []),
    ];
    const requestId = input.requestId ?? crypto.randomUUID();
    let attempts = 0;
    let lastCause: unknown;
    let lastFailure: GeminiFailureDetails = { retryable: false };

    for (const candidate of models) {
      if (candidate.fallbackUsed && !lastFailure.retryable) break;
      for (
        let modelAttempt = 0;
        modelAttempt < candidate.maximumAttempts &&
        attempts < GEMINI_RETRY_POLICY.maximumTotalAttempts;
        modelAttempt += 1
      ) {
        if (controller.signal.aborted) {
          throw (
            controller.signal.reason ??
            new DOMException("Aborted", "AbortError")
          );
        }
        if (deadlineAt - now() < GEMINI_RETRY_POLICY.minimumAttemptBudgetMs) {
          throw new GeminiProviderError({
            ...lastFailure,
            retryable: lastFailure.retryable,
            attempts,
            model: candidate.model,
            fallbackUsed: candidate.fallbackUsed,
            deadlineExceeded: true,
            cause:
              lastCause ??
              new DOMException("Gemini deadline exceeded", "TimeoutError"),
          });
        }
        attempts += 1;
        const attemptStartedAt = now();
        try {
          const response = await generateContent({
            model: candidate.model,
            signal: controller.signal,
          });
          const timetable = parseGeminiTimetableResponse(response.text);
          logger.info(
            "[ai-timetable] Gemini request completed",
            attemptLog({
              requestId,
              model: candidate.model,
              attempt: attempts,
              durationMs: now() - attemptStartedAt,
              fallbackUsed: candidate.fallbackUsed,
              outcome: "succeeded",
            }),
          );
          return timetable;
        } catch (cause) {
          if (controller.signal.aborted) {
            throw controller.signal.reason ?? cause;
          }
          if (isAbort(cause)) throw cause;
          if (cause instanceof AiTimetableValidationError) throw cause;
          lastCause = cause;
          lastFailure = failureDetails(cause);
          const hasPrimaryRetry =
            !candidate.fallbackUsed &&
            modelAttempt + 1 < candidate.maximumAttempts;
          const canRetryModel =
            lastFailure.retryable &&
            hasPrimaryRetry &&
            attempts < GEMINI_RETRY_POLICY.maximumTotalAttempts;
          if (canRetryModel) {
            const delay = retryDelay(modelAttempt, random);
            if (
              deadlineAt - now() <
              delay + GEMINI_RETRY_POLICY.minimumAttemptBudgetMs
            ) {
              throw new GeminiProviderError({
                ...lastFailure,
                attempts,
                model: candidate.model,
                fallbackUsed: candidate.fallbackUsed,
                deadlineExceeded: true,
                cause,
              });
            }
            logger.warn(
              "[ai-timetable] Retrying Gemini request",
              attemptLog({
                requestId,
                model: candidate.model,
                attempt: attempts,
                durationMs: now() - attemptStartedAt,
                failure: lastFailure,
                fallbackUsed: candidate.fallbackUsed,
                outcome: "retrying",
              }),
            );
            await sleep(delay, controller.signal);
            continue;
          }
          const canUseFallback =
            lastFailure.retryable &&
            !candidate.fallbackUsed &&
            Boolean(fallbackModel) &&
            attempts < GEMINI_RETRY_POLICY.maximumTotalAttempts;
          if (canUseFallback) {
            logger.warn(
              "[ai-timetable] Switching to configured Gemini fallback",
              attemptLog({
                requestId,
                model: candidate.model,
                attempt: attempts,
                durationMs: now() - attemptStartedAt,
                failure: lastFailure,
                fallbackUsed: false,
                outcome: "retrying",
              }),
            );
            break;
          }
          const finalError = new GeminiProviderError({
            ...lastFailure,
            attempts,
            model: candidate.model,
            fallbackUsed: candidate.fallbackUsed,
            cause,
          });
          logger.error(
            "[ai-timetable] Gemini request failed",
            attemptLog({
              requestId,
              model: candidate.model,
              attempt: attempts,
              durationMs: now() - attemptStartedAt,
              failure: lastFailure,
              fallbackUsed: candidate.fallbackUsed,
              outcome: "failed",
            }),
          );
          throw finalError;
        }
      }
    }
    throw new GeminiProviderError({
      ...lastFailure,
      attempts,
      model: fallbackModel ?? primaryModel,
      fallbackUsed: Boolean(fallbackModel),
      cause: lastCause,
    });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", parentAborted);
  }
}

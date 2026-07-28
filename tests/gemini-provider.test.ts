import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_RETRY_POLICY,
  GEMINI_TIMETABLE_JSON_SCHEMA,
  GeminiProviderError,
  type GeminiRuntimeOptions,
  analyseWithGemini,
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

function providerFailure(status: number, providerStatus?: string) {
  return Object.assign(
    new Error(
      JSON.stringify({
        error: { code: status, status: providerStatus, message: "private" },
      }),
    ),
    { status },
  );
}

function timetableImage() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], "table.jpg", {
    type: "image/jpeg",
  });
}

type GenerateContent = NonNullable<GeminiRuntimeOptions["generateContent"]>;

function providerMock(implementation: GenerateContent) {
  return vi.fn(implementation);
}

function retryRuntime(
  generateContent: ReturnType<typeof providerMock>,
  deadlineMs = 10_000,
) {
  let now = 0;
  const sleep = vi.fn(async (milliseconds: number) => {
    now += milliseconds;
  });
  return {
    options: {
      generateContent,
      sleep,
      now: () => now,
      random: () => 0,
      deadlineMs,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
    sleep,
  };
}

function providerInput(fallbackModel?: string, signal?: AbortSignal) {
  return {
    apiKey: "test-key",
    model: "primary-model",
    fallbackModel,
    image: timetableImage(),
    signal,
    requestId: "request-1",
  };
}

describe("Gemini transient retry policy", () => {
  it("returns immediately when the first attempt succeeds", async () => {
    const generate = providerMock(async () => ({
      text: JSON.stringify(validGeminiResponse()),
    }));
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(providerInput(), runtime.options),
    ).resolves.toMatchObject({ sessions: [{ subjectCode: "CSE501" }] });
    expect(generate).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
  });

  it("retries one 503 before succeeding", async () => {
    const generate = providerMock(async () => ({
      text: JSON.stringify(validGeminiResponse()),
    }))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockResolvedValueOnce({ text: JSON.stringify(validGeminiResponse()) });
    const runtime = retryRuntime(generate);
    await analyseWithGemini(providerInput(), runtime.options);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(runtime.sleep).toHaveBeenCalledWith(400, expect.any(AbortSignal));
  });

  it("retries two transient failures with injected exponential backoff", async () => {
    const generate = providerMock(async () => ({
      text: JSON.stringify(validGeminiResponse()),
    }))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockResolvedValueOnce({ text: JSON.stringify(validGeminiResponse()) });
    const runtime = retryRuntime(generate);
    await analyseWithGemini(providerInput(), runtime.options);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(runtime.sleep.mock.calls.map(([delay]) => delay)).toEqual([
      400, 1_000,
    ]);
  });

  it("throws structured details after all transient attempts are exhausted", async () => {
    const generate = providerMock(async () => {
      throw providerFailure(503, "UNAVAILABLE");
    });
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(providerInput(), runtime.options),
    ).rejects.toMatchObject({
      name: "GeminiProviderError",
      status: 503,
      providerStatus: "UNAVAILABLE",
      retryable: true,
      attempts: 3,
      fallbackUsed: false,
    });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["invalid request", 400],
    ["authentication", 403],
  ])("does not retry %s failures", async (_label, status) => {
    const generate = providerMock(async () => {
      throw providerFailure(status);
    });
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(providerInput(), runtime.options),
    ).rejects.toMatchObject({ retryable: false, attempts: 1 });
    expect(generate).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
  });

  it("does not retry an aborted request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Cancelled", "AbortError"));
    const generate = providerMock(async () => ({
      text: JSON.stringify(validGeminiResponse()),
    }));
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(
        providerInput(undefined, controller.signal),
        runtime.options,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not sleep or retry when the deadline lacks another attempt budget", async () => {
    const generate = providerMock(async () => {
      throw providerFailure(503, "UNAVAILABLE");
    });
    const runtime = retryRuntime(generate, 1_800);
    await expect(
      analyseWithGemini(providerInput(), runtime.options),
    ).rejects.toMatchObject({
      name: "GeminiProviderError",
      attempts: 1,
      deadlineExceeded: true,
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
  });

  it("uses one configured fallback attempt after primary retries", async () => {
    const generate = providerMock(async () => ({
      text: JSON.stringify(validGeminiResponse()),
    }))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockRejectedValueOnce(providerFailure(503, "UNAVAILABLE"))
      .mockResolvedValueOnce({ text: JSON.stringify(validGeminiResponse()) });
    const runtime = retryRuntime(generate);
    await analyseWithGemini(providerInput("fallback-model"), runtime.options);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(generate.mock.calls.map(([call]) => call.model)).toEqual([
      "primary-model",
      "primary-model",
      "primary-model",
      "fallback-model",
    ]);
  });

  it.each([
    ["is absent", undefined],
    ["matches the primary", "primary-model"],
  ])("does not use a fallback that %s", async (_label, fallback) => {
    const generate = providerMock(async () => {
      throw providerFailure(503, "UNAVAILABLE");
    });
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(providerInput(fallback), runtime.options),
    ).rejects.toBeInstanceOf(GeminiProviderError);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("never exceeds the documented total provider-call cap", async () => {
    const generate = providerMock(async () => {
      throw providerFailure(503, "UNAVAILABLE");
    });
    const runtime = retryRuntime(generate);
    await expect(
      analyseWithGemini(providerInput("fallback-model"), runtime.options),
    ).rejects.toMatchObject({ attempts: 4, fallbackUsed: true });
    expect(generate).toHaveBeenCalledTimes(
      GEMINI_RETRY_POLICY.maximumTotalAttempts,
    );
  });
});

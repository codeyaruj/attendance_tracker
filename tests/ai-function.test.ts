import { describe, expect, it, vi } from "vitest";

import { createTimetableAnalysisHandler } from "@/functions/api/timetable/analyse";
import {
  DEFAULT_GEMINI_MODEL,
  GeminiProviderError,
} from "@/functions/api/timetable/gemini";
import { validAiTimetable } from "./ai-timetable-validation.test";

function context(
  request: Request,
  key = "test-key",
  model?: string,
  fallbackModel?: string,
) {
  return {
    request,
    env: {
      GEMINI_API_KEY: key,
      GEMINI_MODEL: model,
      GEMINI_FALLBACK_MODEL: fallbackModel,
    },
  };
}

function uploadRequest(
  options: { image?: File; hints?: string; url?: string } = {},
) {
  const form = new FormData();
  if (options.image !== undefined) form.set("image", options.image);
  if (options.hints !== undefined) form.set("localHints", options.hints);
  const url =
    options.url ?? "https://attendance.example.pages.dev/api/timetable/analyse";
  const request = new Request(url, {
    method: "POST",
    headers: {
      Origin: new URL(url).origin,
      "Content-Type": "multipart/form-data; boundary=test",
    },
  });
  return Object.assign(request, { formData: async () => form });
}

describe("Cloudflare timetable analysis Function", () => {
  it("rejects non-POST requests without caching", async () => {
    const response = await createTimetableAnalysisHandler(vi.fn())(
      context(
        new Request(
          "https://attendance.example.pages.dev/api/timetable/analyse",
        ),
      ),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["missing image", uploadRequest(), 400, "MISSING_IMAGE"],
    [
      "unsupported type",
      uploadRequest({
        image: new File(["gif"], "table.gif", { type: "image/gif" }),
      }),
      415,
      "UNSUPPORTED_IMAGE_TYPE",
    ],
    [
      "invalid hints",
      uploadRequest({ image: image(), hints: "{" }),
      400,
      "INVALID_HINTS",
    ],
  ])("rejects %s", async (_label, request, status, code) => {
    const response = await createTimetableAnalysisHandler(vi.fn())(
      context(request as Request),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code } });
  });

  it("returns AI_NOT_CONFIGURED without calling the provider", async () => {
    const provider = vi.fn();
    const response = await createTimetableAnalysisHandler(provider)(
      context(uploadRequest({ image: image() }), ""),
    );
    expect(response.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: "AI_NOT_CONFIGURED" },
    });
  });

  it("rejects oversized images before invoking the provider", async () => {
    const provider = vi.fn();
    const oversized = new File(
      [new Uint8Array(8 * 1024 * 1024 + 1)],
      "large.png",
      {
        type: "image/png",
      },
    );
    const response = await createTimetableAnalysisHandler(provider)(
      context(uploadRequest({ image: oversized })),
    );
    expect(response.status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: "IMAGE_TOO_LARGE" },
    });
  });

  it("rejects duplicate multipart fields before invoking the provider", async () => {
    const provider = vi.fn();
    const request = uploadRequest({ image: image() });
    const form = await request.formData();
    form.append("image", image());
    Object.assign(request, { formData: async () => form });
    const response = await createTimetableAnalysisHandler(provider)(
      context(request),
    );
    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_HINTS" },
    });
  });

  it("returns independently validated structured data", async () => {
    const response = await createTimetableAnalysisHandler(
      vi.fn(async () => validAiTimetable()),
    )(
      context(
        uploadRequest({
          image: image(),
          hints: JSON.stringify({ detectedDays: ["MONDAY"] }),
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { sessions: [{ subjectCode: "CSE501" }] },
    });
  });

  it("uses the default model and honours the environment override", async () => {
    const provider = vi.fn(async () => validAiTimetable());
    await createTimetableAnalysisHandler(provider)(
      context(uploadRequest({ image: image() })),
    );
    expect(provider).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: DEFAULT_GEMINI_MODEL }),
    );

    await createTimetableAnalysisHandler(provider)(
      context(uploadRequest({ image: image() }), "test-key", "custom-model"),
    );
    expect(provider).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "custom-model" }),
    );

    await createTimetableAnalysisHandler(provider)(
      context(
        uploadRequest({ image: image() }),
        "test-key",
        "custom-model",
        "fallback-model",
      ),
    );
    expect(provider).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "custom-model",
        fallbackModel: "fallback-model",
        signal: expect.any(AbortSignal),
        requestId: expect.any(String),
      }),
    );
  });

  it("maps exhausted Gemini capacity to a retryable HTTP 503", async () => {
    const response = await createTimetableAnalysisHandler(
      vi.fn(async () => {
        throw new GeminiProviderError({
          status: 503,
          providerStatus: "UNAVAILABLE",
          retryable: true,
          attempts: 3,
          model: "primary-model",
          fallbackUsed: false,
          cause: new Error("private provider detail"),
        });
      }),
    )(context(uploadRequest({ image: image() })));
    const copy = response.clone();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get("X-Request-ID")).toBeTruthy();
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "AI schedule analysis is temporarily unavailable.",
        retryable: true,
      },
    });
    expect(await copy.text()).not.toContain("private provider detail");
  });

  it("maps rate limits and invalid/empty model output safely", async () => {
    const rateLimit = Object.assign(new Error("provider internals"), {
      status: 429,
    });
    const limited = await createTimetableAnalysisHandler(
      vi.fn(async () => {
        throw rateLimit;
      }),
    )(context(uploadRequest({ image: image() })));
    const limitedCopy = limited.clone();
    expect(await limited.json()).toMatchObject({
      error: { code: "AI_RATE_LIMITED" },
    });
    expect(await limitedCopy.text()).not.toContain("provider internals");

    const empty = validAiTimetable();
    empty.sessions = [];
    const invalid = await createTimetableAnalysisHandler(
      vi.fn(async () => empty),
    )(context(uploadRequest({ image: image() })));
    expect(await invalid.json()).toMatchObject({
      error: { code: "NO_TIMETABLE_DETECTED" },
    });
  });

  it("maps timeout and malformed model output without exposing internals", async () => {
    const timeout = new DOMException("provider secret", "AbortError");
    const timedOut = await createTimetableAnalysisHandler(
      vi.fn(async () => {
        throw timeout;
      }),
    )(context(uploadRequest({ image: image() })));
    expect(await timedOut.json()).toMatchObject({
      error: { code: "AI_TIMEOUT" },
    });

    const malformed = await createTimetableAnalysisHandler(
      vi.fn(async () => ({ sessions: "not-an-array" }) as never),
    )(context(uploadRequest({ image: image() })));
    expect(await malformed.json()).toMatchObject({
      error: { code: "AI_INVALID_RESPONSE" },
    });
  });

  it.each([
    [
      400,
      { response: { status: 400 }, error: { code: "INVALID_ARGUMENT" } },
      "AI_INVALID_RESPONSE",
      422,
    ],
    [403, { error: { status: 403 } }, "AI_PROVIDER_ERROR", 502],
    [404, { status: 404 }, "AI_PROVIDER_ERROR", 502],
    [429, { status: 429 }, "AI_RATE_LIMITED", 429],
    [500, { error: { code: 500 } }, "AI_PROVIDER_ERROR", 502],
    [502, { response: { status: 502 } }, "AI_PROVIDER_ERROR", 502],
    [503, { code: 503 }, "AI_PROVIDER_UNAVAILABLE", 503],
    [504, { response: { status: 504 } }, "AI_TIMEOUT", 504],
  ])(
    "maps provider HTTP %i safely",
    async (_providerStatus, shape, code, publicStatus) => {
      const response = await createTimetableAnalysisHandler(
        vi.fn(async () => {
          throw Object.assign(new Error("private provider detail"), shape);
        }),
      )(context(uploadRequest({ image: image() })));
      const copy = response.clone();
      expect(response.status).toBe(publicStatus);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(await copy.text()).not.toContain("private provider detail");
    },
  );

  it("logs bounded redacted diagnostics locally and nothing in production", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const key = "secret-api-key-for-test";
    const hint = "private OCR hint";
    const encodedImage = "A".repeat(120);
    const provider = vi.fn(async () => {
      throw Object.assign(
        new Error(`${key} ${hint} private-table.jpg ${encodedImage}`),
        { response: { status: 503 }, error: { code: "UNAVAILABLE" } },
      );
    });
    const hints = JSON.stringify({ rawText: hint });
    const localResponse = await createTimetableAnalysisHandler(provider)(
      context(
        uploadRequest({
          image: image(),
          hints,
          url: "http://127.0.0.1:8788/api/timetable/analyse",
        }),
        key,
        "diagnostic-model",
      ),
    );
    const logged = JSON.stringify(log.mock.calls);
    const diagnostic = log.mock.calls[0]?.[1] as {
      model: string;
      elapsedMs: number;
      name: string;
      status: number;
      code: string;
      message: string;
    };
    const body = await localResponse.text();
    expect(log).toHaveBeenCalledOnce();
    expect(diagnostic).toMatchObject({
      model: "diagnostic-model",
      name: "Error",
      status: 503,
      code: "UNAVAILABLE",
    });
    expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(logged).not.toContain(key);
    expect(logged).not.toContain(hint);
    expect(logged).not.toContain("private-table.jpg");
    expect(logged).not.toContain(encodedImage);
    expect(diagnostic.message.length).toBeLessThanOrEqual(500);
    expect(body).not.toContain(key);
    expect(body).not.toContain(hint);

    log.mockClear();
    await createTimetableAnalysisHandler(provider)(
      context(uploadRequest({ image: image(), hints }), key),
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

function image() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], "table.jpg", {
    type: "image/jpeg",
  });
}

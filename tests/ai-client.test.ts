import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiTimetableRequestError,
  requestAiTimetable,
} from "@/lib/ai-timetable/client";

function image() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], "table.jpg", {
    type: "image/jpeg",
  });
}

describe("AI timetable client errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves retryable capacity metadata without retrying client-side", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "AI_PROVIDER_UNAVAILABLE",
            message: "AI schedule analysis is temporarily unavailable.",
            retryable: true,
          },
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const error = await requestAiTimetable(image(), undefined).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(AiTimetableRequestError);
    expect(error).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: true,
      retryAfter: 5,
      message:
        "Gemini is temporarily busy. Please wait a moment and try again.",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps malformed successful responses non-retryable", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { ok: true, data: { sessions: "invalid" } },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(requestAiTimetable(image(), undefined)).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
      status: 200,
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not misclassify missing server configuration as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: {
              code: "AI_NOT_CONFIGURED",
              message: "AI schedule analysis is not configured.",
            },
          },
          { status: 503 },
        ),
      ),
    );

    await expect(requestAiTimetable(image(), undefined)).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      status: 503,
      retryable: false,
    });
  });
});

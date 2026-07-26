import { describe, expect, it, vi } from "vitest";

import { createTimetableAnalysisHandler } from "@/functions/api/timetable/analyse";
import { validAiTimetable } from "./ai-timetable-validation.test";

function context(request: Request, key = "test-key") {
  return { request, env: { GEMINI_API_KEY: key } };
}

function uploadRequest(options: { image?: File; hints?: string } = {}) {
  const form = new FormData();
  if (options.image !== undefined) form.set("image", options.image);
  if (options.hints !== undefined) form.set("localHints", options.hints);
  const request = new Request(
    "https://attendance.example.pages.dev/api/timetable/analyse",
    {
      method: "POST",
      headers: {
        Origin: "https://attendance.example.pages.dev",
        "Content-Type": "multipart/form-data; boundary=test",
      },
    },
  );
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
});

function image() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], "table.jpg", {
    type: "image/jpeg",
  });
}

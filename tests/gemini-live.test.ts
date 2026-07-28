import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  GeminiProviderError,
  analyseWithGemini,
} from "@/functions/api/timetable/gemini";

const apiKey = process.env.GEMINI_API_KEY;
const enabled = process.env.RUN_LIVE_GEMINI_SMOKE === "1" && Boolean(apiKey);

describe.skipIf(!enabled)("live Gemini timetable smoke", () => {
  it("returns a structurally valid timetable or reports provider capacity separately", async () => {
    const fixture = await sharp(
      Buffer.from(`<svg width="900" height="360" xmlns="http://www.w3.org/2000/svg">
        <rect width="900" height="360" fill="white"/>
        <g stroke="black" fill="none" stroke-width="2">
          <rect x="20" y="20" width="860" height="320"/>
          <path d="M180 20v320M530 20v320M20 100h860M20 180h860M20 260h860"/>
        </g>
        <g font-family="Arial" font-size="24" fill="black">
          <text x="45" y="70">Day / Time</text><text x="250" y="70">09:00-10:00</text><text x="600" y="70">10:00-11:00</text>
          <text x="45" y="150">Monday</text><text x="250" y="150">CSE501 Algorithms</text><text x="600" y="150">MAT501 Mathematics</text>
          <text x="45" y="230">Tuesday</text><text x="250" y="230">PHY501 Physics</text><text x="600" y="230">CSE502 Networks</text>
        </g>
      </svg>`),
    )
      .png()
      .toBuffer();
    const image = new File(
      [new Uint8Array(fixture)],
      "synthetic-timetable.png",
      {
        type: "image/png",
      },
    );

    try {
      const result = await analyseWithGemini(
        {
          apiKey: apiKey!,
          model: process.env.GEMINI_MODEL,
          fallbackModel: process.env.GEMINI_FALLBACK_MODEL,
          image,
          requestId: "live-smoke",
        },
        { deadlineMs: 60_000 },
      );
      expect(result.sessions.length).toBeGreaterThan(0);
    } catch (cause) {
      if (cause instanceof GeminiProviderError && cause.retryable) {
        console.warn(
          `[ai-timetable] Live smoke inconclusive: provider unavailable after ${cause.attempts} attempts.`,
        );
        return;
      }
      throw cause;
    }
  }, 65_000);
});

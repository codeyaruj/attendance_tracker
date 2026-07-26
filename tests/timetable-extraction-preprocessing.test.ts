import { describe, expect, it } from "vitest";
import { transformPixels } from "@/lib/timetable-extraction";

describe("deterministic timetable image preprocessing", () => {
  it("converts pixels to greyscale without mutating the source", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
    const original = new Uint8ClampedArray(data);
    const result = transformPixels(
      { data, width: 2, height: 1 },
      { contrast: 1, sharpen: false },
    );

    expect(data).toEqual(original);
    expect(result.data[0]).toBe(result.data[1]);
    expect(result.data[1]).toBe(result.data[2]);
    expect(result.data[4]).toBe(result.data[5]);
    expect(result.data[5]).toBe(result.data[6]);
    expect(result.data[3]).toBe(255);
    expect(result.data[7]).toBe(128);
  });

  it("applies an optional binary threshold", () => {
    const result = transformPixels(
      {
        data: new Uint8ClampedArray([30, 30, 30, 255, 220, 220, 220, 255]),
        width: 2,
        height: 1,
      },
      { contrast: 1, threshold: 128, sharpen: false },
    );

    expect([...result.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

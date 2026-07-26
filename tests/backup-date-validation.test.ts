import { describe, expect, it } from "vitest";
import {
  isOrderedTimeRange,
  isStrictIsoDate,
  isStrictLocalTime,
  isStrictTimestamp,
  isoDateSchema,
  timeSchema,
} from "@/lib/validation";

describe("strict academic date and time validation", () => {
  it.each(["2026-01-31", "2024-02-29", "2000-02-29"])(
    "accepts valid date %s",
    (value) => expect(isStrictIsoDate(value)).toBe(true),
  );

  it.each([
    "2026-02-31",
    "2025-04-31",
    "2026-13-01",
    "2026-00-10",
    "2025-02-29",
    "26-01-01",
  ])("rejects impossible date %s", (value) => {
    expect(isStrictIsoDate(value)).toBe(false);
    expect(isoDateSchema.safeParse(value).success).toBe(false);
  });

  it.each(["00:00", "09:05", "23:59"])("accepts valid time %s", (value) => {
    expect(isStrictLocalTime(value)).toBe(true);
    expect(timeSchema.safeParse(value).success).toBe(true);
  });

  it.each(["25:00", "10:75", "9:00", "24:00"])(
    "rejects invalid time %s",
    (value) => expect(isStrictLocalTime(value)).toBe(false),
  );

  it("requires a class to end after it starts", () => {
    expect(isOrderedTimeRange("09:00", "10:00")).toBe(true);
    expect(isOrderedTimeRange("10:00", "09:00")).toBe(false);
    expect(isOrderedTimeRange("10:00", "10:00")).toBe(false);
  });

  it("rejects impossible full timestamps", () => {
    expect(isStrictTimestamp("2026-02-28T10:00:00.000Z")).toBe(true);
    expect(isStrictTimestamp("2026-02-31T10:00:00.000Z")).toBe(false);
    expect(isStrictTimestamp("2026-02-28T25:00:00.000Z")).toBe(false);
  });

  it("keeps calendar validation independent from the process timezone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    expect(isStrictIsoDate("2024-02-29")).toBe(true);
    expect(isStrictIsoDate("2025-02-29")).toBe(false);
    process.env.TZ = previous;
  });
});

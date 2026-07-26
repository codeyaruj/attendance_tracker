import { describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  basisPointsToPercentage,
  percentageToBasisPoints,
  safeExportFilename,
  settingsWithTrackedType,
  subjectOverrideChanges,
  validateAttendanceCounts,
  validateSubjectThresholds,
  validateThresholdPair,
} from "@/components/settings/settings-model";
import { defaultAppSettings } from "@/db";

describe("settings model", () => {
  it("converts decimal attendance thresholds to basis points exactly", () => {
    expect(percentageToBasisPoints(67.5)).toBe(6750);
    expect(basisPointsToPercentage(6750)).toBe("67.5");
    expect(validateThresholdPair(60, 67.5)).toEqual({
      valid: true,
      minimumBasisPoints: 6000,
      safetyBasisPoints: 6750,
    });
  });

  it("rejects invalid or inverted threshold pairs", () => {
    expect(validateThresholdPair(70, 65)).toMatchObject({ valid: false });
    expect(validateThresholdPair(-1, 65)).toMatchObject({ valid: false });
    expect(validateThresholdPair(60, 101)).toMatchObject({ valid: false });
    expect(validateThresholdPair(Number.NaN, 65)).toMatchObject({
      valid: false,
    });
  });

  it("uses semester defaults for blank subject overrides", () => {
    expect(validateSubjectThresholds("", "", 6000, 6500)).toMatchObject({
      valid: true,
      minimumBasisPoints: 6000,
      safetyBasisPoints: 6500,
    });
    expect(validateSubjectThresholds("70", "", 6000, 6500)).toMatchObject({
      valid: false,
    });
    expect(subjectOverrideChanges("67.5", "72")).toEqual({
      minimumAttendanceBasisPointsOverride: 6750,
      safetyTargetBasisPointsOverride: 7200,
    });
    expect(subjectOverrideChanges("", "")).toEqual({
      minimumAttendanceBasisPointsOverride: undefined,
      safetyTargetBasisPointsOverride: undefined,
    });
  });

  it("validates editable mid-semester attendance totals", () => {
    expect(validateAttendanceCounts("12", "9")).toEqual({
      valid: true,
      held: 12,
      attended: 9,
    });
    expect(validateAttendanceCounts("5", "6")).toMatchObject({
      valid: false,
    });
    expect(validateAttendanceCounts("2.5", "2")).toMatchObject({
      valid: false,
    });
    expect(validateAttendanceCounts("", "")).toMatchObject({
      valid: false,
    });
  });

  it("updates one tracked class type without mutating current settings", () => {
    const settings = defaultAppSettings("2026-07-23T10:00:00.000Z");
    const next = settingsWithTrackedType(settings, "LAB", true);

    expect(next.LAB).toBe(true);
    expect(settings.trackedClassTypes.LAB).toBe(false);
    expect(next.THEORY).toBe(true);
  });

  it("creates safe portable filenames", () => {
    expect(safeExportFilename("ECE Semester 5 / Aruj")).toBe(
      "ece-semester-5-aruj",
    );
    expect(safeExportFilename("!!!")).toBe("attendsafe");
  });

  it("applies persistent and system theme preferences", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    applyThemePreference("LIGHT");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("attendsafe-theme")).toBe("light");

    applyThemePreference("DARK");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("attendsafe-theme")).toBe("dark");

    applyThemePreference("SYSTEM");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("attendsafe-theme")).toBeNull();
  });
});

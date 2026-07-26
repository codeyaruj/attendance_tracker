import type { AppSettings, Subject, ThemePreference } from "@/types/domain";

export interface ThresholdValidation {
  valid: boolean;
  message?: string;
  minimumBasisPoints?: number;
  safetyBasisPoints?: number;
}

export interface AttendanceCountValidation {
  valid: boolean;
  message?: string;
  held?: number;
  attended?: number;
}

export function percentageToBasisPoints(value: number): number {
  return Math.round(value * 100);
}

export function basisPointsToPercentage(value: number): string {
  return String(value / 100);
}

export function validateThresholdPair(
  minimumPercentage: number,
  safetyPercentage: number,
): ThresholdValidation {
  if (
    !Number.isFinite(minimumPercentage) ||
    !Number.isFinite(safetyPercentage)
  ) {
    return { valid: false, message: "Enter valid attendance percentages." };
  }
  if (
    minimumPercentage < 0 ||
    minimumPercentage > 100 ||
    safetyPercentage < 0 ||
    safetyPercentage > 100
  ) {
    return { valid: false, message: "Percentages must be between 0 and 100." };
  }
  if (safetyPercentage < minimumPercentage) {
    return {
      valid: false,
      message: "Safety target must be equal to or above the minimum.",
    };
  }
  return {
    valid: true,
    minimumBasisPoints: percentageToBasisPoints(minimumPercentage),
    safetyBasisPoints: percentageToBasisPoints(safetyPercentage),
  };
}

export function parseOptionalPercentage(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function validateSubjectThresholds(
  minimumValue: string,
  safetyValue: string,
  semesterMinimumBasisPoints: number,
  semesterSafetyBasisPoints: number,
): ThresholdValidation {
  const parsedMinimum = parseOptionalPercentage(minimumValue);
  const parsedSafety = parseOptionalPercentage(safetyValue);
  const minimum =
    parsedMinimum === undefined
      ? semesterMinimumBasisPoints / 100
      : parsedMinimum;
  const safety =
    parsedSafety === undefined ? semesterSafetyBasisPoints / 100 : parsedSafety;
  return validateThresholdPair(minimum, safety);
}

export function validateAttendanceCounts(
  heldValue: string,
  attendedValue: string,
): AttendanceCountValidation {
  if (!heldValue.trim() || !attendedValue.trim()) {
    return {
      valid: false,
      message: "Enter both classes held and classes attended.",
    };
  }
  const held = Number(heldValue);
  const attended = Number(attendedValue);
  if (!Number.isInteger(held) || !Number.isInteger(attended)) {
    return {
      valid: false,
      message: "Classes held and attended must be whole numbers.",
    };
  }
  if (held < 0 || attended < 0 || attended > held) {
    return {
      valid: false,
      message: "Attendance must satisfy 0 ≤ attended ≤ held.",
    };
  }
  return { valid: true, held, attended };
}

export function subjectOverrideChanges(
  minimumValue: string,
  safetyValue: string,
): Pick<
  Subject,
  "minimumAttendanceBasisPointsOverride" | "safetyTargetBasisPointsOverride"
> {
  const minimum = parseOptionalPercentage(minimumValue);
  const safety = parseOptionalPercentage(safetyValue);
  return {
    minimumAttendanceBasisPointsOverride:
      minimum === undefined ? undefined : percentageToBasisPoints(minimum),
    safetyTargetBasisPointsOverride:
      safety === undefined ? undefined : percentageToBasisPoints(safety),
  };
}

export function applyThemePreference(theme: ThemePreference): void {
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "DARK" || (theme === "SYSTEM" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  if (theme === "SYSTEM") {
    localStorage.removeItem("attendsafe-theme");
  } else {
    localStorage.setItem(
      "attendsafe-theme",
      theme === "DARK" ? "dark" : "light",
    );
  }
}

export function settingsWithTrackedType(
  settings: AppSettings,
  classType: keyof AppSettings["trackedClassTypes"],
  checked: boolean,
): AppSettings["trackedClassTypes"] {
  return { ...settings.trackedClassTypes, [classType]: checked };
}

export function safeExportFilename(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safe || "attendsafe";
}

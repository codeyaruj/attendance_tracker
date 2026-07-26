import type { AttendanceStatus } from "@/types/domain";

export const BASIS_POINTS_SCALE = 10_000;
export const DEFAULT_BORDERLINE_MARGIN_BASIS_POINTS = 25;

export interface AttendanceCounts {
  attended: number;
  held: number;
}

export interface ThresholdAttendanceCounts extends AttendanceCounts {
  thresholdBasisPoints: number;
}

export interface AttendanceProjection {
  currentAttended: number;
  currentHeld: number;
  currentPercentageBasisPoints: number | null;
  projectedAttended: number;
  projectedHeld: number;
  projectedPercentageBasisPoints: number | null;
  additionalAttended: number;
  additionalHeld: number;
  missedSessions: number;
}

export interface MultipleSessionProjectionInput extends AttendanceCounts {
  additionalAttended?: number;
  additionalAbsences?: number;
  statuses?: readonly AttendanceStatus[];
  exemptPolicy?: "EXCLUDED" | "ATTENDED";
}

export interface RequiredAttendanceInput extends ThresholdAttendanceCounts {
  remainingSessions: number;
}

export type ProjectionClassification =
  "SAFE" | "CAUTION" | "BORDERLINE" | "UNSAFE" | "NO_DATA";

const SCALE_BIGINT = BigInt(BASIS_POINTS_SCALE);

function assertSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function assertValidAttendanceCounts(
  attended: number,
  held: number,
): void {
  assertSafeNonNegativeInteger(attended, "attended");
  assertSafeNonNegativeInteger(held, "held");
  if (attended > held) {
    throw new RangeError("attended cannot be greater than held.");
  }
}

export function assertValidBasisPoints(
  value: number,
  label = "thresholdBasisPoints",
): void {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_SCALE) {
    throw new RangeError(
      `${label} must be an integer from 0 through ${BASIS_POINTS_SCALE}.`,
    );
  }
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds JavaScript's safe integer range.`);
  }
  return Number(value);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("The division denominator must be positive.");
  }
  if (numerator <= 0n) {
    return 0n;
  }
  return (numerator + denominator - 1n) / denominator;
}

function normalizeCounts(
  attendedOrCounts: number | AttendanceCounts,
  held?: number,
): AttendanceCounts {
  const counts =
    typeof attendedOrCounts === "number"
      ? { attended: attendedOrCounts, held: held as number }
      : attendedOrCounts;

  assertValidAttendanceCounts(counts.attended, counts.held);
  return counts;
}

function normalizeThresholdCounts(
  attendedOrInput: number | ThresholdAttendanceCounts,
  held?: number,
  thresholdBasisPoints?: number,
): ThresholdAttendanceCounts {
  const input =
    typeof attendedOrInput === "number"
      ? {
          attended: attendedOrInput,
          held: held as number,
          thresholdBasisPoints: thresholdBasisPoints as number,
        }
      : attendedOrInput;

  assertValidAttendanceCounts(input.attended, input.held);
  assertValidBasisPoints(input.thresholdBasisPoints);
  return input;
}

/**
 * Returns attendance rounded to the nearest basis point for display. Threshold
 * decisions should use compareAttendanceToThreshold so rounding cannot alter a
 * safety result.
 */
export function calculateAttendance(counts: AttendanceCounts): number | null;
export function calculateAttendance(
  attended: number,
  held: number,
): number | null;
export function calculateAttendance(
  attendedOrCounts: number | AttendanceCounts,
  held?: number,
): number | null {
  const counts = normalizeCounts(attendedOrCounts, held);
  if (counts.held === 0) {
    return null;
  }

  const numerator = BigInt(counts.attended) * SCALE_BIGINT;
  const denominator = BigInt(counts.held);
  return Number((numerator + denominator / 2n) / denominator);
}

/** Compares the exact fraction attended / held with a basis-point threshold. */
export function compareAttendanceToThreshold(
  attended: number,
  held: number,
  thresholdBasisPoints: number,
): -1 | 0 | 1 | null {
  assertValidAttendanceCounts(attended, held);
  assertValidBasisPoints(thresholdBasisPoints);
  if (held === 0) {
    return null;
  }

  const actual = BigInt(attended) * SCALE_BIGINT;
  const required = BigInt(held) * BigInt(thresholdBasisPoints);
  return actual < required ? -1 : actual > required ? 1 : 0;
}

export function isAttendanceAtOrAbove(
  attended: number,
  held: number,
  thresholdBasisPoints: number,
): boolean {
  const comparison = compareAttendanceToThreshold(
    attended,
    held,
    thresholdBasisPoints,
  );
  return comparison === 0 || comparison === 1;
}

export function calculateSkippableClasses(
  input: ThresholdAttendanceCounts,
): number;
export function calculateSkippableClasses(
  attended: number,
  held: number,
  thresholdBasisPoints: number,
): number;
export function calculateSkippableClasses(
  attendedOrInput: number | ThresholdAttendanceCounts,
  held?: number,
  thresholdBasisPoints?: number,
): number {
  const input = normalizeThresholdCounts(
    attendedOrInput,
    held,
    thresholdBasisPoints,
  );

  if (input.thresholdBasisPoints === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const margin =
    BigInt(input.attended) * SCALE_BIGINT -
    BigInt(input.held) * BigInt(input.thresholdBasisPoints);
  if (margin < 0n) {
    return 0;
  }

  return toSafeNumber(
    margin / BigInt(input.thresholdBasisPoints),
    "skippable class count",
  );
}

export function calculateRecoveryClasses(
  input: ThresholdAttendanceCounts,
): number;
export function calculateRecoveryClasses(
  attended: number,
  held: number,
  thresholdBasisPoints: number,
): number;
export function calculateRecoveryClasses(
  attendedOrInput: number | ThresholdAttendanceCounts,
  held?: number,
  thresholdBasisPoints?: number,
): number {
  const input = normalizeThresholdCounts(
    attendedOrInput,
    held,
    thresholdBasisPoints,
  );

  if (input.held === 0 || input.thresholdBasisPoints === 0) {
    return 0;
  }

  if (
    isAttendanceAtOrAbove(
      input.attended,
      input.held,
      input.thresholdBasisPoints,
    )
  ) {
    return 0;
  }

  if (input.thresholdBasisPoints === BASIS_POINTS_SCALE) {
    return Number.POSITIVE_INFINITY;
  }

  const deficit =
    BigInt(input.thresholdBasisPoints) * BigInt(input.held) -
    BigInt(input.attended) * SCALE_BIGINT;
  return toSafeNumber(
    ceilDivide(
      deficit,
      BigInt(BASIS_POINTS_SCALE - input.thresholdBasisPoints),
    ),
    "recovery class count",
  );
}

function statusDelta(
  status: AttendanceStatus,
  exemptPolicy: "EXCLUDED" | "ATTENDED",
): { attended: number; held: number } {
  switch (status) {
    case "PRESENT":
      return { attended: 1, held: 1 };
    case "ABSENT":
      return { attended: 0, held: 1 };
    case "EXEMPT":
      return exemptPolicy === "ATTENDED"
        ? { attended: 1, held: 1 }
        : { attended: 0, held: 0 };
    case "NOT_MARKED":
      return { attended: 0, held: 0 };
  }
}

function buildProjection(
  attended: number,
  held: number,
  additionalAttended: number,
  additionalHeld: number,
): AttendanceProjection {
  assertValidAttendanceCounts(attended, held);
  assertSafeNonNegativeInteger(additionalAttended, "additionalAttended");
  assertSafeNonNegativeInteger(additionalHeld, "additionalHeld");
  if (additionalAttended > additionalHeld) {
    throw new RangeError("additionalAttended cannot exceed additionalHeld.");
  }
  if (
    attended > Number.MAX_SAFE_INTEGER - additionalAttended ||
    held > Number.MAX_SAFE_INTEGER - additionalHeld
  ) {
    throw new RangeError(
      "Projected attendance exceeds the safe integer range.",
    );
  }

  const projectedAttended = attended + additionalAttended;
  const projectedHeld = held + additionalHeld;
  return {
    currentAttended: attended,
    currentHeld: held,
    currentPercentageBasisPoints: calculateAttendance(attended, held),
    projectedAttended,
    projectedHeld,
    projectedPercentageBasisPoints: calculateAttendance(
      projectedAttended,
      projectedHeld,
    ),
    additionalAttended,
    additionalHeld,
    missedSessions: additionalHeld - additionalAttended,
  };
}

export function projectSingleAttendance(
  counts: AttendanceCounts,
  status?: AttendanceStatus | boolean,
  exemptPolicy?: "EXCLUDED" | "ATTENDED",
): AttendanceProjection;
export function projectSingleAttendance(
  attended: number,
  held: number,
  status?: AttendanceStatus | boolean,
  exemptPolicy?: "EXCLUDED" | "ATTENDED",
): AttendanceProjection;
export function projectSingleAttendance(
  attendedOrCounts: number | AttendanceCounts,
  heldOrStatus?: number | AttendanceStatus | boolean,
  statusOrPolicy?: AttendanceStatus | boolean | "EXCLUDED" | "ATTENDED",
  maybeExemptPolicy: "EXCLUDED" | "ATTENDED" = "EXCLUDED",
): AttendanceProjection {
  const objectForm = typeof attendedOrCounts !== "number";
  const counts = objectForm
    ? normalizeCounts(attendedOrCounts)
    : normalizeCounts(attendedOrCounts, heldOrStatus as number);
  const suppliedStatus: AttendanceStatus | boolean | undefined = objectForm
    ? (heldOrStatus as AttendanceStatus | boolean | undefined)
    : (statusOrPolicy as AttendanceStatus | boolean | undefined);
  const status: AttendanceStatus =
    typeof suppliedStatus === "boolean"
      ? suppliedStatus
        ? "PRESENT"
        : "ABSENT"
      : suppliedStatus === undefined
        ? "ABSENT"
        : suppliedStatus;
  const exemptPolicy = objectForm
    ? statusOrPolicy === "ATTENDED" || statusOrPolicy === "EXCLUDED"
      ? statusOrPolicy
      : "EXCLUDED"
    : maybeExemptPolicy;
  const delta = statusDelta(status, exemptPolicy);
  return buildProjection(
    counts.attended,
    counts.held,
    delta.attended,
    delta.held,
  );
}

export function projectMultipleSessions(
  input: MultipleSessionProjectionInput,
): AttendanceProjection;
export function projectMultipleSessions(
  attended: number,
  held: number,
  additionalAttended: number,
  additionalAbsences: number,
): AttendanceProjection;
export function projectMultipleSessions(
  attendedOrInput: number | MultipleSessionProjectionInput,
  held?: number,
  additionalAttended = 0,
  additionalAbsences = 0,
): AttendanceProjection {
  if (typeof attendedOrInput !== "number") {
    const input = attendedOrInput;
    assertValidAttendanceCounts(input.attended, input.held);
    if (input.statuses !== undefined) {
      let attendedDelta = 0;
      let heldDelta = 0;
      for (const status of input.statuses) {
        const delta = statusDelta(status, input.exemptPolicy ?? "EXCLUDED");
        attendedDelta += delta.attended;
        heldDelta += delta.held;
      }
      return buildProjection(
        input.attended,
        input.held,
        attendedDelta,
        heldDelta,
      );
    }

    const attendedDelta = input.additionalAttended ?? 0;
    const absenceDelta = input.additionalAbsences ?? 0;
    assertSafeNonNegativeInteger(absenceDelta, "additionalAbsences");
    if (attendedDelta > Number.MAX_SAFE_INTEGER - absenceDelta) {
      throw new RangeError("Additional session count exceeds the safe range.");
    }
    return buildProjection(
      input.attended,
      input.held,
      attendedDelta,
      attendedDelta + absenceDelta,
    );
  }

  assertSafeNonNegativeInteger(additionalAbsences, "additionalAbsences");
  if (additionalAttended > Number.MAX_SAFE_INTEGER - additionalAbsences) {
    throw new RangeError("Additional session count exceeds the safe range.");
  }
  return buildProjection(
    attendedOrInput,
    held as number,
    additionalAttended,
    additionalAttended + additionalAbsences,
  );
}

export function classifyProjection(
  projectedPercentageBasisPoints: number | null,
  minimumBasisPoints: number,
  safetyBasisPoints: number,
  borderlineMarginBasisPoints = DEFAULT_BORDERLINE_MARGIN_BASIS_POINTS,
): ProjectionClassification {
  assertValidBasisPoints(minimumBasisPoints, "minimumBasisPoints");
  assertValidBasisPoints(safetyBasisPoints, "safetyBasisPoints");
  assertSafeNonNegativeInteger(
    borderlineMarginBasisPoints,
    "borderlineMarginBasisPoints",
  );
  if (safetyBasisPoints < minimumBasisPoints) {
    throw new RangeError(
      "safetyBasisPoints cannot be below minimumBasisPoints.",
    );
  }
  if (projectedPercentageBasisPoints === null) {
    return "NO_DATA";
  }
  assertValidBasisPoints(
    projectedPercentageBasisPoints,
    "projectedPercentageBasisPoints",
  );

  if (projectedPercentageBasisPoints < minimumBasisPoints) {
    return "UNSAFE";
  }
  if (
    projectedPercentageBasisPoints <=
    Math.min(
      BASIS_POINTS_SCALE,
      minimumBasisPoints + borderlineMarginBasisPoints,
    )
  ) {
    return "BORDERLINE";
  }
  if (projectedPercentageBasisPoints >= safetyBasisPoints) {
    return "SAFE";
  }
  return "CAUTION";
}

/** Classifies using the exact attendance fraction, without display rounding. */
export function classifyAttendanceCounts(
  attended: number,
  held: number,
  minimumBasisPoints: number,
  safetyBasisPoints: number,
  borderlineMarginBasisPoints = DEFAULT_BORDERLINE_MARGIN_BASIS_POINTS,
): ProjectionClassification {
  assertValidAttendanceCounts(attended, held);
  assertValidBasisPoints(minimumBasisPoints, "minimumBasisPoints");
  assertValidBasisPoints(safetyBasisPoints, "safetyBasisPoints");
  assertSafeNonNegativeInteger(
    borderlineMarginBasisPoints,
    "borderlineMarginBasisPoints",
  );
  if (safetyBasisPoints < minimumBasisPoints) {
    throw new RangeError(
      "safetyBasisPoints cannot be below minimumBasisPoints.",
    );
  }
  if (held === 0) {
    return "NO_DATA";
  }

  const actual = BigInt(attended) * SCALE_BIGINT;
  const heldBigInt = BigInt(held);
  const minimum = heldBigInt * BigInt(minimumBasisPoints);
  if (actual < minimum) {
    return "UNSAFE";
  }

  const borderlineThreshold =
    heldBigInt *
    BigInt(
      Math.min(
        BASIS_POINTS_SCALE,
        minimumBasisPoints + borderlineMarginBasisPoints,
      ),
    );
  if (actual <= borderlineThreshold) {
    return "BORDERLINE";
  }

  const safety = heldBigInt * BigInt(safetyBasisPoints);
  return actual >= safety ? "SAFE" : "CAUTION";
}

export function calculateAttendanceBuffer(
  input: ThresholdAttendanceCounts,
): number;
export function calculateAttendanceBuffer(
  attended: number,
  held: number,
  thresholdBasisPoints: number,
): number;
export function calculateAttendanceBuffer(
  attendedOrInput: number | ThresholdAttendanceCounts,
  held?: number,
  thresholdBasisPoints?: number,
): number {
  return typeof attendedOrInput === "number"
    ? calculateSkippableClasses(
        attendedOrInput,
        held as number,
        thresholdBasisPoints as number,
      )
    : calculateSkippableClasses(attendedOrInput);
}

export function calculateRequiredAttendanceForRemainingSessions(
  input: RequiredAttendanceInput,
): number;
export function calculateRequiredAttendanceForRemainingSessions(
  attended: number,
  held: number,
  remainingSessions: number,
  thresholdBasisPoints: number,
): number;
export function calculateRequiredAttendanceForRemainingSessions(
  attendedOrInput: number | RequiredAttendanceInput,
  held?: number,
  remainingSessions?: number,
  thresholdBasisPoints?: number,
): number {
  const input =
    typeof attendedOrInput === "number"
      ? {
          attended: attendedOrInput,
          held: held as number,
          remainingSessions: remainingSessions as number,
          thresholdBasisPoints: thresholdBasisPoints as number,
        }
      : attendedOrInput;
  assertValidAttendanceCounts(input.attended, input.held);
  assertSafeNonNegativeInteger(input.remainingSessions, "remainingSessions");
  assertValidBasisPoints(input.thresholdBasisPoints);
  if (input.held > Number.MAX_SAFE_INTEGER - input.remainingSessions) {
    throw new RangeError("Final held count exceeds the safe integer range.");
  }

  const finalHeld = BigInt(input.held + input.remainingSessions);
  const requiredNumerator =
    BigInt(input.thresholdBasisPoints) * finalHeld -
    BigInt(input.attended) * SCALE_BIGINT;
  const required = toSafeNumber(
    ceilDivide(requiredNumerator, SCALE_BIGINT),
    "required attendance count",
  );
  return required > input.remainingSessions
    ? Number.POSITIVE_INFINITY
    : required;
}

export function basisPointsToPercentage(
  basisPoints: number | null,
): number | null {
  if (basisPoints === null) {
    return null;
  }
  assertValidBasisPoints(basisPoints, "basisPoints");
  return basisPoints / 100;
}

export function formatBasisPoints(
  basisPoints: number | null,
  maximumFractionDigits = 2,
  emptyLabel = "No classes held",
): string {
  if (basisPoints === null) {
    return emptyLabel;
  }
  assertValidBasisPoints(basisPoints, "basisPoints");
  if (
    !Number.isInteger(maximumFractionDigits) ||
    maximumFractionDigits < 0 ||
    maximumFractionDigits > 2
  ) {
    throw new RangeError("maximumFractionDigits must be 0, 1, or 2.");
  }

  const divisor = 10 ** (2 - maximumFractionDigits);
  const rounded = Math.round(basisPoints / divisor) * divisor;
  const whole = Math.floor(rounded / 100);
  const fraction = String(rounded % 100)
    .padStart(2, "0")
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");
  return `${whole}${fraction.length > 0 ? `.${fraction}` : ""}%`;
}

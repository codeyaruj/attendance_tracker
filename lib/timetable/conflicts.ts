import type { TimetableSlot } from "@/types/domain";

export interface SlotDuplicate {
  signature: string;
  slotIds: string[];
}

export interface SlotConflict {
  firstSlotId: string;
  secondSlotId: string;
  dayOfWeek: TimetableSlot["dayOfWeek"];
  overlapStartTime: string;
  overlapEndTime: string;
  reason: "OVERLAPPING_CLASSES";
}

export interface ConflictDetectionOptions {
  includeInactive?: boolean;
  includePlaceholders?: boolean;
  includeBreaks?: boolean;
}

function timeToMinutes(value: string): number | undefined {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function canonicalArray(values: readonly string[]): string {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase()))]
    .sort()
    .join(",");
}

export function createSlotSignature(slot: TimetableSlot): string {
  return [
    slot.timetableVersionId,
    slot.subjectId ?? "",
    slot.dayOfWeek,
    slot.startTime,
    slot.endTime,
    canonicalArray(slot.batchRestriction),
    slot.electiveGroupId ?? "",
    slot.weekPattern,
    slot.customWeekPattern?.trim().toLocaleLowerCase() ?? "",
    String(slot.isPlaceholder),
    String(slot.isBreak),
  ].join("|");
}

export function detectDuplicateSlots(
  slots: readonly TimetableSlot[],
): SlotDuplicate[] {
  const groups = new Map<string, string[]>();
  slots.forEach((slot) => {
    const signature = createSlotSignature(slot);
    const ids = groups.get(signature) ?? [];
    ids.push(slot.id);
    groups.set(signature, ids);
  });
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([signature, slotIds]) => ({ signature, slotIds: slotIds.sort() }))
    .sort((left, right) => left.signature.localeCompare(right.signature));
}

export function slotsOverlap(
  first: Pick<TimetableSlot, "dayOfWeek" | "startTime" | "endTime">,
  second: Pick<TimetableSlot, "dayOfWeek" | "startTime" | "endTime">,
): boolean {
  if (first.dayOfWeek !== second.dayOfWeek) return false;
  const firstStart = timeToMinutes(first.startTime);
  const firstEnd = timeToMinutes(first.endTime);
  const secondStart = timeToMinutes(second.startTime);
  const secondEnd = timeToMinutes(second.endTime);
  if (
    firstStart === undefined ||
    firstEnd === undefined ||
    secondStart === undefined ||
    secondEnd === undefined
  ) {
    return false;
  }
  return firstStart < secondEnd && secondStart < firstEnd;
}

function restrictionsAreDisjoint(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length === 0 || second.length === 0) return false;
  const firstValues = new Set(first.map((value) => value.toLocaleLowerCase()));
  return !second.some((value) => firstValues.has(value.toLocaleLowerCase()));
}

function slotsAreAlternatives(
  first: TimetableSlot,
  second: TimetableSlot,
): boolean {
  if (
    (first.weekPattern === "ODD_WEEK" && second.weekPattern === "EVEN_WEEK") ||
    (first.weekPattern === "EVEN_WEEK" && second.weekPattern === "ODD_WEEK")
  ) {
    return true;
  }
  if (
    restrictionsAreDisjoint(first.batchRestriction, second.batchRestriction)
  ) {
    return true;
  }
  return Boolean(
    first.electiveGroupId &&
    first.electiveGroupId === second.electiveGroupId &&
    first.subjectId !== second.subjectId,
  );
}

function slotParticipates(
  slot: TimetableSlot,
  options: ConflictDetectionOptions,
): boolean {
  if (!options.includeInactive && !slot.isEnabled) return false;
  if (!options.includePlaceholders && slot.isPlaceholder) return false;
  if (!options.includeBreaks && slot.isBreak) return false;
  return true;
}

export function detectSlotConflicts(
  slots: readonly TimetableSlot[],
  options: ConflictDetectionOptions = {},
): SlotConflict[] {
  const candidates = slots.filter((slot) => slotParticipates(slot, options));
  const duplicatePairs = new Set<string>();
  detectDuplicateSlots(candidates).forEach((duplicate) => {
    for (
      let firstIndex = 0;
      firstIndex < duplicate.slotIds.length;
      firstIndex += 1
    ) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < duplicate.slotIds.length;
        secondIndex += 1
      ) {
        duplicatePairs.add(
          [duplicate.slotIds[firstIndex], duplicate.slotIds[secondIndex]]
            .sort()
            .join("|"),
        );
      }
    }
  });

  const conflicts: SlotConflict[] = [];
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex];
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < candidates.length;
      secondIndex += 1
    ) {
      const second = candidates[secondIndex];
      const pair = [first.id, second.id].sort().join("|");
      if (
        duplicatePairs.has(pair) ||
        first.timetableVersionId !== second.timetableVersionId ||
        !slotsOverlap(first, second) ||
        slotsAreAlternatives(first, second)
      ) {
        continue;
      }
      conflicts.push({
        firstSlotId: first.id,
        secondSlotId: second.id,
        dayOfWeek: first.dayOfWeek,
        overlapStartTime:
          first.startTime > second.startTime
            ? first.startTime
            : second.startTime,
        overlapEndTime:
          first.endTime < second.endTime ? first.endTime : second.endTime,
        reason: "OVERLAPPING_CLASSES",
      });
    }
  }
  return conflicts.sort((left, right) => {
    const dayComparison = left.dayOfWeek.localeCompare(right.dayOfWeek);
    if (dayComparison !== 0) return dayComparison;
    const timeComparison = left.overlapStartTime.localeCompare(
      right.overlapStartTime,
    );
    if (timeComparison !== 0) return timeComparison;
    return left.firstSlotId.localeCompare(right.firstSlotId);
  });
}

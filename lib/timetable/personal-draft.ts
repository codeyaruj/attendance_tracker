import { DAYS_OF_WEEK, type NormalizedTimetableDraft } from "@/types";

export function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function normalizeSelectedGroups(values: readonly string[]): string[] {
  const groups = new Map<string, string>();
  for (const value of values) {
    const display = value.trim().replace(/\s+/g, " ");
    const normalized = normalizeGroupName(display);
    if (normalized && !groups.has(normalized)) groups.set(normalized, display);
  }
  return [...groups.values()];
}

export function resolveSelectedGroups(value: {
  selectedBatches?: readonly string[];
  selectedBatch?: string;
}): string[] {
  return normalizeSelectedGroups(
    value.selectedBatches ?? (value.selectedBatch ? [value.selectedBatch] : []),
  );
}

export function createPersonalTimetableDraft({
  draft,
  selectedGroups,
  selectedSlotIds,
  excludedSlotIds = [],
}: {
  draft: NormalizedTimetableDraft;
  selectedGroups: readonly string[];
  selectedSlotIds: ReadonlySet<string> | readonly string[];
  excludedSlotIds?: ReadonlySet<string> | readonly string[];
}): NormalizedTimetableDraft {
  const normalizedGroups = new Set(
    normalizeSelectedGroups(selectedGroups).map(normalizeGroupName),
  );
  const selectedIds =
    selectedSlotIds instanceof Set ? selectedSlotIds : new Set(selectedSlotIds);
  const excludedIds =
    excludedSlotIds instanceof Set ? excludedSlotIds : new Set(excludedSlotIds);

  const timetableSlots = draft.timetableSlots
    .filter((slot) => {
      if (slot.isBreak) return true;
      if (excludedIds.has(slot.temporaryId)) return false;
      if (selectedIds.has(slot.temporaryId)) return true;
      return slot.batchOptions.some((group) =>
        normalizedGroups.has(normalizeGroupName(group)),
      );
    })
    .map((slot) => ({
      ...slot,
      faculty: [...slot.faculty],
      batchOptions: [...slot.batchOptions],
    }));
  const subjectIds = new Set(
    timetableSlots.flatMap((slot) =>
      !slot.isBreak && slot.subjectTemporaryId ? [slot.subjectTemporaryId] : [],
    ),
  );
  const subjects = draft.subjects
    .filter((subject) => subjectIds.has(subject.temporaryId))
    .map((subject) => ({ ...subject, faculty: [...subject.faculty] }));
  const detectedElectiveGroups = draft.detectedElectiveGroups.flatMap(
    (group) => {
      const options = group.options.filter((option) =>
        subjectIds.has(option.subjectTemporaryId),
      );
      return options.length
        ? [{ ...group, options: options.map((option) => ({ ...option })) }]
        : [];
    },
  );
  const electiveGroupIds = new Set(
    detectedElectiveGroups.map((group) => group.id),
  );
  const cleanedSlots = timetableSlots.map((slot) => {
    if (slot.isBreak) {
      return {
        ...slot,
        subjectTemporaryId: undefined,
        electiveGroupId: undefined,
      };
    }
    return slot.electiveGroupId && !electiveGroupIds.has(slot.electiveGroupId)
      ? { ...slot, electiveGroupId: undefined }
      : slot;
  });
  const timeSlots = Array.from(
    new Map(
      cleanedSlots.map((slot) => [
        `${slot.startTime}-${slot.endTime}`,
        { startTime: slot.startTime, endTime: slot.endTime },
      ]),
    ).values(),
  ).sort((left, right) => left.startTime.localeCompare(right.startTime));

  return {
    ...draft,
    days: DAYS_OF_WEEK.filter((day) =>
      cleanedSlots.some((slot) => slot.dayOfWeek === day),
    ),
    timeSlots,
    subjects,
    timetableSlots: cleanedSlots,
    detectedBatchOptions: normalizeSelectedGroups(
      cleanedSlots.flatMap((slot) => slot.batchOptions),
    ),
    detectedElectiveGroups,
    ambiguousItems: draft.ambiguousItems.map((item) => ({
      ...item,
      possibleValues: [...item.possibleValues],
    })),
    warnings: [...draft.warnings],
  };
}

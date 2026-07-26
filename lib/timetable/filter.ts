import type {
  ClassType,
  ElectiveGroup,
  Subject,
  TimetableSlot,
} from "@/types/domain";

export interface TimetableFilterOptions {
  slots: readonly TimetableSlot[];
  subjects: readonly Subject[];
  electiveGroups?: readonly ElectiveGroup[];
  selectedBatch?: string | null;
  selectedElectiveSubjectIds?: readonly string[];
  trackedClassTypes?: Partial<Record<ClassType, boolean>>;
  includeZeroCredit?: boolean;
  includeDisabled?: boolean;
  includePlaceholders?: boolean;
  includeBreaks?: boolean;
}

function normalizeSelection(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function getSelectedElectiveSubjectIds(
  groups: readonly ElectiveGroup[] = [],
  explicitSelection?: readonly string[],
): Set<string> {
  if (explicitSelection !== undefined) return new Set(explicitSelection);
  return new Set(groups.flatMap((group) => group.selectedSubjectIds));
}

export function filterTimetableSlots({
  slots,
  subjects,
  electiveGroups = [],
  selectedBatch,
  selectedElectiveSubjectIds,
  trackedClassTypes,
  includeZeroCredit = true,
  includeDisabled = false,
  includePlaceholders = false,
  includeBreaks = false,
}: TimetableFilterOptions): TimetableSlot[] {
  const subjectsById = new Map(
    subjects.map((subject) => [subject.id, subject]),
  );
  const selectedElectives = getSelectedElectiveSubjectIds(
    electiveGroups,
    selectedElectiveSubjectIds,
  );
  const normalizedBatch = selectedBatch
    ? normalizeSelection(selectedBatch)
    : undefined;

  return slots.filter((slot) => {
    if (!includeDisabled && !slot.isEnabled) return false;
    if (!includePlaceholders && slot.isPlaceholder) return false;
    if (!includeBreaks && slot.isBreak) return false;
    if (slot.isBreak) return includeBreaks;
    if (!slot.subjectId) return false;

    const subject = subjectsById.get(slot.subjectId);
    if (!subject) return false;
    if (!includeDisabled && !subject.isEnabled) return false;
    if (!includeZeroCredit && subject.isZeroCredit) return false;
    if (trackedClassTypes?.[subject.classType] === false) return false;

    if (slot.batchRestriction.length > 0) {
      if (!normalizedBatch) return false;
      if (
        !slot.batchRestriction.some(
          (batch) => normalizeSelection(batch) === normalizedBatch,
        )
      ) {
        return false;
      }
    }

    if (slot.electiveGroupId && !selectedElectives.has(subject.id))
      return false;
    return true;
  });
}

export interface SubjectFilterOptions extends Omit<
  TimetableFilterOptions,
  "slots" | "subjects"
> {
  subjects: readonly Subject[];
}

export function filterSubjectsForTracking({
  subjects,
  electiveGroups = [],
  selectedElectiveSubjectIds,
  trackedClassTypes,
  includeZeroCredit = true,
  includeDisabled = false,
}: SubjectFilterOptions): Subject[] {
  const selectedElectives = getSelectedElectiveSubjectIds(
    electiveGroups,
    selectedElectiveSubjectIds,
  );
  const electiveSubjectIds = new Set(
    electiveGroups.flatMap((group) =>
      group.options.map((option) => option.subjectId),
    ),
  );
  return subjects.filter((subject) => {
    if (!includeDisabled && !subject.isEnabled) return false;
    if (!includeZeroCredit && subject.isZeroCredit) return false;
    if (trackedClassTypes?.[subject.classType] === false) return false;
    if (
      electiveSubjectIds.has(subject.id) &&
      !selectedElectives.has(subject.id)
    ) {
      return false;
    }
    return true;
  });
}

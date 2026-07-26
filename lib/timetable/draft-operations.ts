import type {
  DraftElectiveGroup,
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types/draft";

function normalizedKey(value?: string): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return normalized || undefined;
}

export interface DuplicateSubjectSummary {
  groupCount: number;
  duplicateCount: number;
}

function duplicateSubjectGroups(
  subjects: readonly DraftSubject[],
): DraftSubject[][] {
  const groups: DraftSubject[][] = [];
  const groupByKey = new Map<string, DraftSubject[]>();

  subjects.forEach((subject) => {
    const keys = [normalizedKey(subject.code), normalizedKey(subject.name)]
      .filter((key): key is string => Boolean(key))
      .map((key) => `subject:${key}`);
    const existing = keys.flatMap((key) => groupByKey.get(key) ?? []).at(0);
    const group = existing
      ? groups.find((candidate) => candidate.includes(existing))!
      : [];
    if (!existing) groups.push(group);
    group.push(subject);
    keys.forEach((key) => groupByKey.set(key, group));
  });

  return groups.filter((group) => group.length > 1);
}

export function summarizeDuplicateSubjects(
  subjects: readonly DraftSubject[],
): DuplicateSubjectSummary {
  const groups = duplicateSubjectGroups(subjects);
  return {
    groupCount: groups.length,
    duplicateCount: groups.reduce(
      (count, group) => count + group.length - 1,
      0,
    ),
  };
}

function mergeSubjectValues(
  primary: DraftSubject,
  duplicate: DraftSubject,
): DraftSubject {
  return {
    ...primary,
    code: primary.code || duplicate.code,
    shortName: primary.shortName || duplicate.shortName,
    credits: Math.max(primary.credits, duplicate.credits),
    faculty: Array.from(new Set([...primary.faculty, ...duplicate.faculty])),
    isZeroCredit: primary.isZeroCredit || duplicate.isZeroCredit,
    confidence: Math.max(primary.confidence, duplicate.confidence),
  };
}

function rewireElectiveGroup(
  group: DraftElectiveGroup,
  canonicalIdById: ReadonlyMap<string, string>,
): DraftElectiveGroup {
  const options = new Map<
    string,
    { subjectTemporaryId: string; label: string }
  >();
  group.options.forEach((option) => {
    const subjectTemporaryId =
      canonicalIdById.get(option.subjectTemporaryId) ??
      option.subjectTemporaryId;
    if (!options.has(subjectTemporaryId)) {
      options.set(subjectTemporaryId, { ...option, subjectTemporaryId });
    }
  });
  return { ...group, options: [...options.values()] };
}

export function mergeDuplicateSubjects(draft: NormalizedTimetableDraft): {
  draft: NormalizedTimetableDraft;
  mergedCount: number;
} {
  const duplicateGroups = duplicateSubjectGroups(draft.subjects);
  if (duplicateGroups.length === 0) return { draft, mergedCount: 0 };

  const canonicalIdById = new Map<string, string>();
  const mergedByCanonicalId = new Map<string, DraftSubject>();
  duplicateGroups.forEach((group) => {
    const [primary, ...duplicates] = group;
    const merged = duplicates.reduce(mergeSubjectValues, primary);
    mergedByCanonicalId.set(primary.temporaryId, merged);
    group.forEach((subject) =>
      canonicalIdById.set(subject.temporaryId, primary.temporaryId),
    );
  });

  const subjects = draft.subjects.flatMap((subject) => {
    const canonicalId = canonicalIdById.get(subject.temporaryId);
    if (!canonicalId) return [subject];
    if (canonicalId !== subject.temporaryId) return [];
    return [mergedByCanonicalId.get(canonicalId) ?? subject];
  });

  return {
    mergedCount: draft.subjects.length - subjects.length,
    draft: {
      ...draft,
      subjects,
      timetableSlots: draft.timetableSlots.map((slot) => ({
        ...slot,
        subjectTemporaryId: slot.subjectTemporaryId
          ? (canonicalIdById.get(slot.subjectTemporaryId) ??
            slot.subjectTemporaryId)
          : undefined,
      })),
      detectedElectiveGroups: draft.detectedElectiveGroups.map((group) =>
        rewireElectiveGroup(group, canonicalIdById),
      ),
    },
  };
}

export function synchronizeDraftAlternatives(
  draft: NormalizedTimetableDraft,
  potentiallyRemovedGroupIds: readonly string[] = [],
): NormalizedTimetableDraft {
  const subjectsById = new Map(
    draft.subjects.map((subject) => [subject.temporaryId, subject]),
  );
  const slotsByGroup = new Map<string, DraftSlot[]>();
  draft.timetableSlots.forEach((slot) => {
    const groupId = slot.electiveGroupId?.trim();
    if (!groupId) return;
    slotsByGroup.set(groupId, [...(slotsByGroup.get(groupId) ?? []), slot]);
  });
  const removable = new Set(
    potentiallyRemovedGroupIds.filter((groupId) => !slotsByGroup.has(groupId)),
  );
  const groups = draft.detectedElectiveGroups
    .filter((group) => !removable.has(group.id))
    .map((group) => ({ ...group, options: [...group.options] }));
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  slotsByGroup.forEach((slots, groupId) => {
    let group = groupsById.get(groupId);
    if (!group) {
      group = { id: groupId, name: groupId, options: [], allowMultiple: false };
      groups.push(group);
      groupsById.set(groupId, group);
    }
    const optionsById = new Map(
      group.options.map((option) => [option.subjectTemporaryId, option]),
    );
    slots.forEach((slot) => {
      if (!slot.subjectTemporaryId) return;
      const subject = subjectsById.get(slot.subjectTemporaryId);
      const current = optionsById.get(slot.subjectTemporaryId);
      optionsById.set(slot.subjectTemporaryId, {
        subjectTemporaryId: slot.subjectTemporaryId,
        label: subject?.name ?? current?.label ?? "Untitled elective",
      });
    });
    group.options = [...optionsById.values()];
  });

  return {
    ...draft,
    detectedBatchOptions: Array.from(
      new Set(
        draft.timetableSlots
          .flatMap((slot) => slot.batchOptions.map((value) => value.trim()))
          .filter(Boolean),
      ),
    ).sort(),
    detectedElectiveGroups: groups,
  };
}

function canonicalArray(values: readonly string[]): string {
  return [
    ...new Set(values.map((value) => normalizedKey(value)).filter(Boolean)),
  ]
    .sort()
    .join(",");
}

export function createDraftSlotSignature(slot: DraftSlot): string {
  return [
    slot.subjectTemporaryId ?? "",
    slot.dayOfWeek,
    slot.startTime,
    slot.endTime,
    slot.classType,
    canonicalArray(slot.batchOptions),
    slot.electiveGroupId ?? "",
    slot.weekPattern,
    normalizedKey(slot.customWeekPattern) ?? "",
    String(slot.isPlaceholder),
    String(slot.isBreak),
  ].join("|");
}

export function countExactDuplicateSlots(slots: readonly DraftSlot[]): number {
  const seen = new Set<string>();
  return slots.reduce((count, slot) => {
    const signature = createDraftSlotSignature(slot);
    if (seen.has(signature)) return count + 1;
    seen.add(signature);
    return count;
  }, 0);
}

function restrictionsAreDisjoint(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length === 0 || second.length === 0) return false;
  const firstValues = new Set(first.map((value) => normalizedKey(value)));
  return !second.some((value) => firstValues.has(normalizedKey(value)));
}

function draftSlotsAreAlternatives(
  first: DraftSlot,
  second: DraftSlot,
): boolean {
  if (
    (first.weekPattern === "ODD_WEEK" && second.weekPattern === "EVEN_WEEK") ||
    (first.weekPattern === "EVEN_WEEK" && second.weekPattern === "ODD_WEEK")
  ) {
    return true;
  }
  if (restrictionsAreDisjoint(first.batchOptions, second.batchOptions))
    return true;
  return Boolean(
    first.electiveGroupId &&
    first.electiveGroupId === second.electiveGroupId &&
    first.subjectTemporaryId !== second.subjectTemporaryId,
  );
}

export function findDraftConflictSlotIds(
  slots: readonly DraftSlot[],
): Set<string> {
  const candidates = slots.filter(
    (slot) => slot.isEnabled && !slot.isBreak && !slot.isPlaceholder,
  );
  const conflicts = new Set<string>();
  candidates.forEach((first, firstIndex) => {
    candidates.slice(firstIndex + 1).forEach((second) => {
      const firstStart = timeToMinutes(first.startTime);
      const firstEnd = timeToMinutes(first.endTime);
      const secondStart = timeToMinutes(second.startTime);
      const secondEnd = timeToMinutes(second.endTime);
      if (
        first.dayOfWeek !== second.dayOfWeek ||
        firstStart === undefined ||
        firstEnd === undefined ||
        secondStart === undefined ||
        secondEnd === undefined ||
        firstStart >= secondEnd ||
        secondStart >= firstEnd ||
        createDraftSlotSignature(first) === createDraftSlotSignature(second) ||
        draftSlotsAreAlternatives(first, second)
      ) {
        return;
      }
      conflicts.add(first.temporaryId);
      conflicts.add(second.temporaryId);
    });
  });
  return conflicts;
}

export function mergeExactDuplicateSlots(draft: NormalizedTimetableDraft): {
  draft: NormalizedTimetableDraft;
  mergedCount: number;
} {
  const slotBySignature = new Map<string, DraftSlot>();
  const orderedSignatures: string[] = [];
  draft.timetableSlots.forEach((slot) => {
    const signature = createDraftSlotSignature(slot);
    const existing = slotBySignature.get(signature);
    if (!existing) {
      slotBySignature.set(signature, slot);
      orderedSignatures.push(signature);
      return;
    }
    slotBySignature.set(signature, {
      ...existing,
      faculty: Array.from(new Set([...existing.faculty, ...slot.faculty])),
      room: existing.room || slot.room,
      notes:
        [existing.notes, slot.notes]
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index)
          .join(" · ") || undefined,
      confidence: Math.max(existing.confidence, slot.confidence),
      isEnabled: existing.isEnabled || slot.isEnabled,
    });
  });
  const timetableSlots = orderedSignatures.map((signature) =>
    slotBySignature.get(signature)!,
  );
  return {
    mergedCount: draft.timetableSlots.length - timetableSlots.length,
    draft: { ...draft, timetableSlots },
  };
}

export function timeToMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60)
    return undefined;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function repeatDraftSlot(
  slot: DraftSlot,
  days: readonly DraftSlot["dayOfWeek"][],
  additionalConsecutivePeriods: number,
): DraftSlot[] {
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);
  if (start === undefined || end === undefined || end <= start) return [];
  const duration = end - start;
  const targetDays = Array.from(new Set([slot.dayOfWeek, ...days]));
  const additions: DraftSlot[] = [];

  targetDays.forEach((day) => {
    for (
      let offset = day === slot.dayOfWeek ? 1 : 0;
      offset <= additionalConsecutivePeriods;
      offset += 1
    ) {
      const startTime = minutesToTime(start + duration * offset);
      const endTime = minutesToTime(end + duration * offset);
      if (!startTime || !endTime) continue;
      additions.push({
        ...slot,
        temporaryId: crypto.randomUUID(),
        dayOfWeek: day,
        startTime,
        endTime,
      });
    }
  });
  return additions;
}

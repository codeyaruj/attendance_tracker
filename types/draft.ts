import type { ClassType, DayOfWeek, WeekPattern } from "./domain";

export interface DraftSubject {
  temporaryId: string;
  code?: string;
  name: string;
  shortName: string;
  credits: number;
  classType: ClassType;
  faculty: string[];
  isZeroCredit: boolean;
  confidence: number;
}

export interface DraftSlot {
  temporaryId: string;
  subjectTemporaryId?: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  faculty: string[];
  room?: string;
  classType: ClassType;
  batchOptions: string[];
  electiveGroupId?: string;
  weekPattern: WeekPattern;
  customWeekPattern?: string;
  notes?: string;
  confidence: number;
  isEnabled: boolean;
  isPlaceholder: boolean;
  isBreak: boolean;
}

export interface DraftElectiveGroup {
  id: string;
  name: string;
  options: Array<{ subjectTemporaryId: string; label: string }>;
  allowMultiple?: boolean;
}

export interface DraftAmbiguousItem {
  id: string;
  field: string;
  possibleValues: string[];
  sourceDescription: string;
  confidence: number;
  resolvedValue?: string;
}

export interface NormalizedTimetableDraft {
  title: string;
  timezone: string;
  days: DayOfWeek[];
  timeSlots: Array<{ startTime: string; endTime: string; label?: string }>;
  subjects: DraftSubject[];
  timetableSlots: DraftSlot[];
  detectedBatchOptions: string[];
  detectedElectiveGroups: DraftElectiveGroup[];
  ambiguousItems: DraftAmbiguousItem[];
  warnings: string[];
  overallConfidence: number;
}

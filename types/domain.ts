export const DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const CLASS_TYPES = [
  "THEORY",
  "LAB",
  "TUTORIAL",
  "SEMINAR",
  "PROJECT",
  "OTHER",
] as const;

export type ClassType = (typeof CLASS_TYPES)[number];

export const WEEK_PATTERNS = [
  "EVERY_WEEK",
  "ODD_WEEK",
  "EVEN_WEEK",
  "CUSTOM",
] as const;

export type WeekPattern = (typeof WEEK_PATTERNS)[number];

export const SESSION_STATUSES = [
  "SCHEDULED",
  "HELD",
  "CANCELLED",
  "HOLIDAY",
  "RESCHEDULED",
  "EXTRA",
  "NOT_CONDUCTED",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "EXEMPT",
  "NOT_MARKED",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type WeekStartPreference = "MONDAY" | "SUNDAY";
export type ThemePreference = "LIGHT" | "DARK" | "SYSTEM";
export type ExceptionType =
  | "HOLIDAY"
  | "BREAK"
  | "CANCELLED_DAY"
  | "CANCELLED_SESSION"
  | "RESCHEDULED_SESSION"
  | "EXTRA_SESSION"
  | "SESSION_OVERRIDE";

export interface TimestampedEntity {
  createdAt: string;
  updatedAt: string;
}

export interface Profile extends TimestampedEntity {
  id: string;
  displayName: string;
  institution?: string;
  course?: string;
  section?: string;
  batch?: string;
  batches?: string[];
  timezone: string;
  weekStartsOn: WeekStartPreference;
}

export interface Semester extends TimestampedEntity {
  id: string;
  profileId: string;
  name: string;
  startDate: string;
  endDate: string;
  minimumAttendanceBasisPoints: number;
  safetyTargetBasisPoints: number;
  teachingDays: DayOfWeek[];
  activeTimetableVersionId?: string;
}

export interface Timetable extends TimestampedEntity {
  id: string;
  semesterId: string;
  title: string;
  timezone: string;
}

export interface TimetableVersion extends TimestampedEntity {
  id: string;
  timetableId: string;
  semesterId: string;
  version: number;
  label: string;
  effectiveStartDate: string;
  effectiveEndDate?: string;
  isConfirmed: boolean;
  source: "UPLOAD" | "MANUAL" | "DEMO" | "IMPORT";
  uploadedReferenceId?: string;
}

export interface Subject extends TimestampedEntity {
  id: string;
  semesterId: string;
  code?: string;
  name: string;
  shortName: string;
  credits: number;
  classType: ClassType;
  minimumAttendanceBasisPointsOverride?: number;
  safetyTargetBasisPointsOverride?: number;
  isZeroCredit: boolean;
  isEnabled: boolean;
  countsCancelledSessions: boolean;
  exemptPolicy: "EXCLUDED" | "ATTENDED";
  initialHeld: number;
  initialAttended: number;
}

export interface ElectiveOption {
  subjectId: string;
  label: string;
}

export interface ElectiveGroup extends TimestampedEntity {
  id: string;
  semesterId: string;
  name: string;
  options: ElectiveOption[];
  selectedSubjectIds: string[];
  allowMultiple?: boolean;
}

export interface TimetableSlot extends TimestampedEntity {
  id: string;
  timetableVersionId: string;
  subjectId?: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  faculty: string[];
  room?: string;
  batchRestriction: string[];
  electiveGroupId?: string;
  weekPattern: WeekPattern;
  customWeekPattern?: string;
  notes?: string;
  isEnabled: boolean;
  isPlaceholder: boolean;
  isBreak: boolean;
}

export interface AcademicException extends TimestampedEntity {
  id: string;
  semesterId: string;
  timetableSlotId?: string;
  classSessionId?: string;
  type: ExceptionType;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  subjectId?: string;
  replacementDate?: string;
  faculty?: string[];
  room?: string;
  notes?: string;
}

export interface ClassSession extends TimestampedEntity {
  id: string;
  semesterId: string;
  subjectId: string;
  timetableSlotId?: string;
  timetableVersionId?: string;
  date: string;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  source: "TIMETABLE" | "EXTRA" | "RESCHEDULED";
  faculty: string[];
  room?: string;
  notes?: string;
}

export interface AttendanceRecord extends TimestampedEntity {
  id: string;
  classSessionId: string;
  status: AttendanceStatus;
  markedAt: string;
  notes?: string;
}

export interface AppSettings {
  id: "app";
  activeProfileId?: string;
  activeSemesterId?: string;
  theme: ThemePreference;
  selectedBatch?: string;
  selectedBatches?: string[];
  trackedClassTypes: Record<ClassType, boolean>;
  includeZeroCredit?: boolean;
  offlineReady: boolean;
  /** Deprecated compatibility field. Always false: no reminder scheduler exists. */
  notificationsPrepared: boolean;
  updatedAt: string;
}

export interface UploadedTimetableReference extends TimestampedEntity {
  id: string;
  profileId?: string;
  semesterId?: string;
  filename: string;
  mediaType: string;
  size: number;
  /** Uint8Array is the portable IndexedDB representation; Blob remains readable for legacy data. */
  blob: Blob | Uint8Array;
  rotation: 0 | 90 | 180 | 270;
  zoom: number;
  crop: { top: number; right: number; bottom: number; left: number };
}

export interface RecentAction extends TimestampedEntity {
  id: string;
  profileId: string;
  semesterId?: string;
  kind: string;
  description: string;
  undoPayload?: Record<string, unknown>;
  undoneAt?: string;
}

export interface ResolvedSession {
  id: string;
  semesterId: string;
  subjectId: string;
  timetableSlotId?: string;
  timetableVersionId?: string;
  date: string;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  source: ClassSession["source"];
  faculty: string[];
  room?: string;
  notes?: string;
  attendanceStatus: AttendanceStatus;
}

export interface SubjectAttendanceSummary {
  subjectId: string;
  held: number;
  attended: number;
  percentageBasisPoints: number | null;
  minimumBasisPoints: number;
  safetyBasisPoints: number;
}

export interface AttendSafeBackup {
  schemaVersion: number;
  exportedAt: string;
  product: "AttendSafe";
  data: {
    profiles: Profile[];
    semesters: Semester[];
    timetables: Timetable[];
    timetableVersions: TimetableVersion[];
    subjects: Subject[];
    electiveGroups: ElectiveGroup[];
    timetableSlots: TimetableSlot[];
    academicExceptions: AcademicException[];
    classSessions: ClassSession[];
    attendanceRecords: AttendanceRecord[];
    appSettings: AppSettings[];
    recentActions: RecentAction[];
  };
}

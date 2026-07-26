import type {
  AcademicException,
  AppSettings,
  AttendanceRecord,
  ClassSession,
  ClassType,
  DayOfWeek,
  ElectiveGroup,
  Profile,
  RecentAction,
  Semester,
  Subject,
  Timetable,
  TimetableSlot,
  TimetableVersion,
  UploadedTimetableReference,
} from "@/types/domain";
import { createDemoTimetable } from "@/lib/demo/timetable";
import { academicExceptionSchema } from "@/lib/validation";

import type { AttendSafeDatabase } from "./database";
import {
  createEntityId,
  createRepositories,
  entityTimestamps,
} from "./repositories";
import { defaultAppSettings, TABLE_NAMES } from "./schema";

export interface AttendSafeSnapshot {
  profiles: Profile[];
  activeProfile?: Profile;
  semesters: Semester[];
  activeSemester?: Semester;
  timetables: Timetable[];
  timetableVersions: TimetableVersion[];
  subjects: Subject[];
  electiveGroups: ElectiveGroup[];
  timetableSlots: TimetableSlot[];
  academicExceptions: AcademicException[];
  classSessions: ClassSession[];
  attendanceRecords: AttendanceRecord[];
  uploadedTimetableReferences: UploadedTimetableReference[];
  recentActions: RecentAction[];
  settings: AppSettings;
}

export async function getDatabaseSnapshot(
  database: AttendSafeDatabase,
  requestedProfileId?: string,
  requestedSemesterId?: string,
): Promise<AttendSafeSnapshot> {
  const repositories = createRepositories(database);
  const [profiles, settings] = await Promise.all([
    repositories.profiles.listByName(),
    repositories.appSettings.getOrCreate(),
  ]);
  const profileId = requestedProfileId ?? settings.activeProfileId;
  const activeProfile = profileId
    ? profiles.find((profile) => profile.id === profileId)
    : undefined;
  const semesters = profileId
    ? await repositories.semesters.listByProfile(profileId)
    : [];
  const semesterId = requestedSemesterId ?? settings.activeSemesterId;
  const activeSemester = semesterId
    ? semesters.find((semester) => semester.id === semesterId)
    : undefined;

  if (!activeSemester) {
    return {
      profiles,
      activeProfile,
      semesters,
      timetables: [],
      timetableVersions: [],
      subjects: [],
      electiveGroups: [],
      timetableSlots: [],
      academicExceptions: [],
      classSessions: [],
      attendanceRecords: [],
      uploadedTimetableReferences: profileId
        ? await repositories.uploadedTimetableReferences.listByProfile(
            profileId,
          )
        : [],
      recentActions: profileId
        ? await repositories.recentActions.listRecent(profileId)
        : [],
      settings,
    };
  }

  const [
    timetables,
    timetableVersions,
    subjects,
    electiveGroups,
    academicExceptions,
    classSessions,
    uploadedTimetableReferences,
    recentActions,
  ] = await Promise.all([
    repositories.timetables.listBySemester(activeSemester.id),
    repositories.timetableVersions.listBySemester(activeSemester.id),
    repositories.subjects.listBySemester(activeSemester.id),
    repositories.electiveGroups.listBySemester(activeSemester.id),
    database.academicExceptions
      .where("semesterId")
      .equals(activeSemester.id)
      .toArray(),
    database.classSessions
      .where("semesterId")
      .equals(activeSemester.id)
      .toArray(),
    repositories.uploadedTimetableReferences.listBySemester(activeSemester.id),
    repositories.recentActions.listRecent(
      profileId ?? activeSemester.profileId,
    ),
  ]);
  const versionIds = timetableVersions.map((version) => version.id);
  const timetableSlots =
    versionIds.length > 0
      ? await database.timetableSlots
          .where("timetableVersionId")
          .anyOf(versionIds)
          .toArray()
      : [];
  const sessionIds = classSessions.map((session) => session.id);
  const attendanceRecords =
    sessionIds.length > 0
      ? await repositories.attendanceRecords.listForSessions(sessionIds)
      : [];

  return {
    profiles,
    activeProfile,
    semesters,
    activeSemester,
    timetables,
    timetableVersions,
    subjects,
    electiveGroups,
    timetableSlots,
    academicExceptions,
    classSessions,
    attendanceRecords,
    uploadedTimetableReferences,
    recentActions,
    settings,
  };
}

export interface CreateProfileSetupInput {
  profile: {
    id?: string;
    displayName: string;
    institution?: string;
    course?: string;
    section?: string;
    batch?: string;
    timezone?: string;
    weekStartsOn?: Profile["weekStartsOn"];
  };
  semester: {
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
    minimumAttendanceBasisPoints?: number;
    safetyTargetBasisPoints?: number;
    teachingDays?: DayOfWeek[];
  };
  academicExceptions?: ProfileSetupAcademicExceptionInput[];
  activate?: boolean;
}

export interface ProfileSetupAcademicExceptionInput {
  id?: string;
  type: Extract<AcademicException["type"], "HOLIDAY" | "BREAK">;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface ProfileSetupResult {
  profile: Profile;
  semester: Semester;
  settings: AppSettings;
}

function assertExceptionWithinSemester(
  exception: Pick<AcademicException, "startDate" | "endDate">,
  semester: Pick<Semester, "startDate" | "endDate">,
): void {
  if (exception.endDate < exception.startDate) {
    throw new Error(
      "Academic exception end date must be on or after its start date.",
    );
  }
  if (
    exception.startDate < semester.startDate ||
    exception.endDate > semester.endDate
  ) {
    throw new Error(
      `Academic exception dates must stay inside the semester (${semester.startDate} to ${semester.endDate}).`,
    );
  }
}

export async function createProfileSetup(
  database: AttendSafeDatabase,
  input: CreateProfileSetupInput,
): Promise<ProfileSetupResult> {
  const displayName = input.profile.displayName.trim();
  if (!displayName) throw new Error("Display name is required.");
  if (input.semester.startDate > input.semester.endDate) {
    throw new Error("Semester end date must be on or after its start date.");
  }
  const minimum = input.semester.minimumAttendanceBasisPoints ?? 6000;
  const safety = input.semester.safetyTargetBasisPoints ?? 6500;
  if (minimum < 0 || minimum > 10_000 || safety < minimum || safety > 10_000) {
    throw new Error(
      "Attendance thresholds must be valid and safety cannot be below minimum.",
    );
  }

  const now = new Date().toISOString();
  const profile: Profile = {
    id: input.profile.id ?? createEntityId(),
    displayName,
    institution: input.profile.institution?.trim() || undefined,
    course: input.profile.course?.trim() || undefined,
    section: input.profile.section?.trim() || undefined,
    batch: input.profile.batch?.trim() || undefined,
    timezone: input.profile.timezone ?? "Asia/Kolkata",
    weekStartsOn: input.profile.weekStartsOn ?? "MONDAY",
    ...entityTimestamps(now),
  };
  const semester: Semester = {
    id: input.semester.id ?? createEntityId(),
    profileId: profile.id,
    name: input.semester.name.trim(),
    startDate: input.semester.startDate,
    endDate: input.semester.endDate,
    minimumAttendanceBasisPoints: minimum,
    safetyTargetBasisPoints: safety,
    teachingDays: input.semester.teachingDays ?? [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
    ],
    ...entityTimestamps(now),
  };
  const academicExceptions = (input.academicExceptions ?? []).map(
    (entry): AcademicException => {
      if (entry.type !== "HOLIDAY" && entry.type !== "BREAK") {
        throw new Error(
          "Semester setup supports only holidays and reading or exam breaks.",
        );
      }
      const exception: AcademicException = {
        id: entry.id ?? createEntityId(),
        semesterId: semester.id,
        type: entry.type,
        startDate: entry.startDate,
        endDate: entry.endDate,
        notes: entry.notes?.trim() || undefined,
        ...entityTimestamps(now),
      };
      assertExceptionWithinSemester(exception, semester);
      return academicExceptionSchema.parse(exception);
    },
  );
  if (
    new Set(academicExceptions.map((exception) => exception.id)).size !==
    academicExceptions.length
  ) {
    throw new Error("Academic exceptions must have unique IDs.");
  }

  return database.transaction(
    "rw",
    [
      database.profiles,
      database.semesters,
      database.academicExceptions,
      database.appSettings,
    ],
    async () => {
      if (await database.profiles.get(profile.id)) {
        throw new Error(`Profile ${profile.id} already exists.`);
      }
      if (await database.semesters.get(semester.id)) {
        throw new Error(`Semester ${semester.id} already exists.`);
      }
      await database.profiles.add(profile);
      await database.semesters.add(semester);
      if (academicExceptions.length > 0) {
        await database.academicExceptions.bulkAdd(academicExceptions);
      }
      const current =
        (await database.appSettings.get("app")) ?? defaultAppSettings(now);
      const settings: AppSettings =
        input.activate === false
          ? current
          : {
              ...current,
              activeProfileId: profile.id,
              activeSemesterId: semester.id,
              selectedBatch: profile.batch,
              updatedAt: now,
            };
      await database.appSettings.put(settings);
      return { profile, semester, settings };
    },
  );
}

export async function saveAcademicException(
  database: AttendSafeDatabase,
  exception: AcademicException,
): Promise<AcademicException> {
  const semester = await database.semesters.get(exception.semesterId);
  if (!semester) {
    throw new Error(
      `Semester ${exception.semesterId} does not exist for this academic exception.`,
    );
  }
  assertExceptionWithinSemester(exception, semester);
  const validated = academicExceptionSchema.parse(exception);
  return createRepositories(database).academicExceptions.put(validated);
}

export interface TimetableBundle {
  timetable: Timetable;
  version: TimetableVersion;
  subjects: Subject[];
  electiveGroups: ElectiveGroup[];
  slots: TimetableSlot[];
  activate?: boolean;
  supersedesVersionId?: string;
}

export interface ManualSubjectInput {
  id?: string;
  clientId?: string;
  code?: string;
  name: string;
  shortName?: string;
  credits?: number;
  classType?: ClassType;
  minimumAttendanceBasisPointsOverride?: number;
  safetyTargetBasisPointsOverride?: number;
  isZeroCredit?: boolean;
  isEnabled?: boolean;
  countsCancelledSessions?: boolean;
  exemptPolicy?: Subject["exemptPolicy"];
  initialHeld?: number;
  initialAttended?: number;
}

export interface ManualElectiveGroupInput {
  id?: string;
  clientId?: string;
  name: string;
  options: Array<{ subjectId: string; label: string }>;
  selectedSubjectIds: string[];
  allowMultiple?: boolean;
}

export interface ManualTimetableSlotInput {
  id?: string;
  subjectId?: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  faculty?: string[];
  room?: string;
  batchRestriction?: string[];
  electiveGroupId?: string;
  weekPattern?: TimetableSlot["weekPattern"];
  customWeekPattern?: string;
  notes?: string;
  isEnabled?: boolean;
  isPlaceholder?: boolean;
  isBreak?: boolean;
}

export interface ManualTimetableInput {
  semesterId: string;
  title: string;
  timezone?: string;
  label?: string;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
  isConfirmed?: boolean;
  source?: TimetableVersion["source"];
  uploadedReferenceId?: string;
  subjects: ManualSubjectInput[];
  electiveGroups?: ManualElectiveGroupInput[];
  slots: ManualTimetableSlotInput[];
  activate?: boolean;
}

function assertTimetableBundle(
  bundle: TimetableBundle,
  semester: Semester,
): void {
  if (bundle.timetable.semesterId !== semester.id) {
    throw new Error("The timetable belongs to a different semester.");
  }
  if (
    bundle.version.semesterId !== semester.id ||
    bundle.version.timetableId !== bundle.timetable.id
  ) {
    throw new Error(
      "The timetable version is not linked to this timetable and semester.",
    );
  }
  if (
    bundle.version.effectiveStartDate < semester.startDate ||
    bundle.version.effectiveStartDate > semester.endDate ||
    (bundle.version.effectiveEndDate !== undefined &&
      (bundle.version.effectiveEndDate < bundle.version.effectiveStartDate ||
        bundle.version.effectiveEndDate > semester.endDate))
  ) {
    throw new Error("Timetable version dates must stay inside the semester.");
  }
  const subjectIds = new Set(bundle.subjects.map((subject) => subject.id));
  if (subjectIds.size !== bundle.subjects.length) {
    throw new Error("The timetable contains duplicate subject IDs.");
  }
  if (bundle.subjects.some((subject) => subject.semesterId !== semester.id)) {
    throw new Error("Every subject must belong to the target semester.");
  }
  if (bundle.electiveGroups.some((group) => group.semesterId !== semester.id)) {
    throw new Error("Every elective group must belong to the target semester.");
  }
  if (
    bundle.electiveGroups.some(
      (group) => !group.allowMultiple && group.selectedSubjectIds.length > 1,
    )
  ) {
    throw new Error(
      "A single-choice elective group cannot select multiple subjects.",
    );
  }
  const electiveIds = new Set(bundle.electiveGroups.map((group) => group.id));
  for (const slot of bundle.slots) {
    if (slot.timetableVersionId !== bundle.version.id) {
      throw new Error(
        "Every slot must belong to the supplied timetable version.",
      );
    }
    if (slot.subjectId && !subjectIds.has(slot.subjectId)) {
      throw new Error(`Slot ${slot.id} references an unknown subject.`);
    }
    if (slot.electiveGroupId && !electiveIds.has(slot.electiveGroupId)) {
      throw new Error(`Slot ${slot.id} references an unknown elective group.`);
    }
    if (slot.startTime >= slot.endTime) {
      throw new Error(`Slot ${slot.id} must end after it starts.`);
    }
  }
}

export async function saveTimetableBundle(
  database: AttendSafeDatabase,
  bundle: TimetableBundle,
): Promise<TimetableBundle> {
  const semester = await database.semesters.get(bundle.version.semesterId);
  if (!semester) throw new Error("The target semester does not exist.");
  assertTimetableBundle(bundle, semester);

  return database.transaction(
    "rw",
    [
      database.semesters,
      database.timetables,
      database.timetableVersions,
      database.subjects,
      database.electiveGroups,
      database.timetableSlots,
    ],
    async () => {
      if (bundle.supersedesVersionId) {
        const previous = await database.timetableVersions.get(
          bundle.supersedesVersionId,
        );
        if (
          !previous ||
          previous.id === bundle.version.id ||
          previous.semesterId !== bundle.version.semesterId ||
          previous.timetableId !== bundle.version.timetableId
        ) {
          throw new Error("The timetable version being replaced is invalid.");
        }
        if (bundle.version.effectiveStartDate < previous.effectiveStartDate) {
          throw new Error(
            "A replacement timetable cannot start before the version it replaces.",
          );
        }
        const boundary = new Date(
          `${bundle.version.effectiveStartDate}T12:00:00Z`,
        );
        if (bundle.version.effectiveStartDate > previous.effectiveStartDate) {
          boundary.setUTCDate(boundary.getUTCDate() - 1);
        }
        await database.timetableVersions.put({
          ...previous,
          effectiveEndDate: boundary.toISOString().slice(0, 10),
          updatedAt: new Date().toISOString(),
        });
      }
      await database.timetables.put(bundle.timetable);
      await database.subjects.bulkPut(bundle.subjects);
      await database.electiveGroups.bulkPut(bundle.electiveGroups);
      await database.timetableVersions.put(bundle.version);
      await database.timetableSlots.bulkPut(bundle.slots);
      if (bundle.activate !== false && bundle.version.isConfirmed) {
        await database.semesters.put({
          ...semester,
          activeTimetableVersionId: bundle.version.id,
          updatedAt: new Date().toISOString(),
        });
      }
      return bundle;
    },
  );
}

function defaultShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 8);
  return words
    .map((word) => word[0])
    .join("")
    .slice(0, 8)
    .toUpperCase();
}

export async function saveManualTimetable(
  database: AttendSafeDatabase,
  input: ManualTimetableInput,
): Promise<TimetableBundle> {
  const semester = await database.semesters.get(input.semesterId);
  if (!semester)
    throw new Error(`Semester ${input.semesterId} does not exist.`);
  if (!input.title.trim()) throw new Error("Timetable title is required.");
  if (input.subjects.length === 0) {
    throw new Error("A timetable must contain at least one subject.");
  }
  const now = new Date().toISOString();
  const timetableId = createEntityId();
  const versionId = createEntityId();
  const subjectIdMap = new Map<string, string>();
  const subjectKeys = new Set<string>();
  const subjects = input.subjects.map((subjectInput) => {
    const id = subjectInput.id ?? createEntityId();
    const keys = subjectInput.clientId ? [id, subjectInput.clientId] : [id];
    for (const key of keys) {
      if (subjectKeys.has(key)) {
        throw new Error(`Duplicate manual subject reference: ${key}`);
      }
      subjectKeys.add(key);
      subjectIdMap.set(key, id);
    }
    if (!subjectInput.name.trim()) throw new Error("Subject name is required.");
    const initialHeld = subjectInput.initialHeld ?? 0;
    const initialAttended = subjectInput.initialAttended ?? 0;
    if (
      !Number.isInteger(initialHeld) ||
      !Number.isInteger(initialAttended) ||
      initialHeld < 0 ||
      initialAttended < 0 ||
      initialAttended > initialHeld
    ) {
      throw new Error(
        `Initial attendance for ${subjectInput.name} must satisfy 0 ≤ attended ≤ held.`,
      );
    }
    return {
      id,
      semesterId: semester.id,
      code: subjectInput.code?.trim() || undefined,
      name: subjectInput.name.trim(),
      shortName:
        subjectInput.shortName?.trim() || defaultShortName(subjectInput.name),
      credits: subjectInput.credits ?? 3,
      classType: subjectInput.classType ?? "THEORY",
      minimumAttendanceBasisPointsOverride:
        subjectInput.minimumAttendanceBasisPointsOverride,
      safetyTargetBasisPointsOverride:
        subjectInput.safetyTargetBasisPointsOverride,
      isZeroCredit: subjectInput.isZeroCredit ?? false,
      isEnabled: subjectInput.isEnabled ?? true,
      countsCancelledSessions: subjectInput.countsCancelledSessions ?? false,
      exemptPolicy: subjectInput.exemptPolicy ?? "EXCLUDED",
      initialHeld,
      initialAttended,
      ...entityTimestamps(now),
    } satisfies Subject;
  });
  const resolveSubjectId = (reference: string): string => {
    const resolved = subjectIdMap.get(reference);
    if (!resolved) throw new Error(`Unknown subject reference: ${reference}`);
    return resolved;
  };
  const electiveIdMap = new Map<string, string>();
  const electiveKeys = new Set<string>();
  const electiveGroups = (input.electiveGroups ?? []).map((groupInput) => {
    const id = groupInput.id ?? createEntityId();
    const keys = groupInput.clientId ? [id, groupInput.clientId] : [id];
    for (const key of keys) {
      if (electiveKeys.has(key)) {
        throw new Error(`Duplicate elective group reference: ${key}`);
      }
      electiveKeys.add(key);
      electiveIdMap.set(key, id);
    }
    if (!groupInput.allowMultiple && groupInput.selectedSubjectIds.length > 1) {
      throw new Error(`${groupInput.name} allows only one selected subject.`);
    }
    return {
      id,
      semesterId: semester.id,
      name: groupInput.name.trim(),
      options: groupInput.options.map((option) => ({
        subjectId: resolveSubjectId(option.subjectId),
        label: option.label.trim(),
      })),
      selectedSubjectIds: groupInput.selectedSubjectIds.map(resolveSubjectId),
      allowMultiple: groupInput.allowMultiple ?? false,
      ...entityTimestamps(now),
    } satisfies ElectiveGroup;
  });
  const timetable: Timetable = {
    id: timetableId,
    semesterId: semester.id,
    title: input.title.trim(),
    timezone:
      input.timezone ??
      (await database.profiles.get(semester.profileId))?.timezone ??
      "Asia/Kolkata",
    ...entityTimestamps(now),
  };
  const version: TimetableVersion = {
    id: versionId,
    timetableId,
    semesterId: semester.id,
    version: 1,
    label: input.label?.trim() || "Initial timetable",
    effectiveStartDate: input.effectiveStartDate ?? semester.startDate,
    effectiveEndDate: input.effectiveEndDate,
    isConfirmed: input.isConfirmed ?? true,
    source: input.source ?? "MANUAL",
    uploadedReferenceId: input.uploadedReferenceId,
    ...entityTimestamps(now),
  };
  const slots = input.slots.map((slotInput) => {
    const electiveGroupId = slotInput.electiveGroupId
      ? electiveIdMap.get(slotInput.electiveGroupId)
      : undefined;
    if (slotInput.electiveGroupId && !electiveGroupId) {
      throw new Error(
        `Unknown elective group reference: ${slotInput.electiveGroupId}`,
      );
    }
    return {
      id: slotInput.id ?? createEntityId(),
      timetableVersionId: versionId,
      subjectId: slotInput.subjectId
        ? resolveSubjectId(slotInput.subjectId)
        : undefined,
      dayOfWeek: slotInput.dayOfWeek,
      startTime: slotInput.startTime,
      endTime: slotInput.endTime,
      faculty: slotInput.faculty ?? [],
      room: slotInput.room?.trim() || undefined,
      batchRestriction: slotInput.batchRestriction ?? [],
      electiveGroupId,
      weekPattern: slotInput.weekPattern ?? "EVERY_WEEK",
      customWeekPattern: slotInput.customWeekPattern,
      notes: slotInput.notes,
      isEnabled: slotInput.isEnabled ?? true,
      isPlaceholder: slotInput.isPlaceholder ?? false,
      isBreak: slotInput.isBreak ?? false,
      ...entityTimestamps(now),
    } satisfies TimetableSlot;
  });
  return saveTimetableBundle(database, {
    timetable,
    version,
    subjects,
    electiveGroups,
    slots,
    activate: input.activate,
  });
}

async function deleteSemesterTreeInTransaction(
  database: AttendSafeDatabase,
  semesterId: string,
): Promise<void> {
  const [versions, sessions] = await Promise.all([
    database.timetableVersions.where("semesterId").equals(semesterId).toArray(),
    database.classSessions.where("semesterId").equals(semesterId).toArray(),
  ]);
  const versionIds = versions.map((version) => version.id);
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length > 0) {
    await database.attendanceRecords
      .where("classSessionId")
      .anyOf(sessionIds)
      .delete();
  }
  if (versionIds.length > 0) {
    await database.timetableSlots
      .where("timetableVersionId")
      .anyOf(versionIds)
      .delete();
  }
  await Promise.all([
    database.academicExceptions.where("semesterId").equals(semesterId).delete(),
    database.classSessions.where("semesterId").equals(semesterId).delete(),
    database.electiveGroups.where("semesterId").equals(semesterId).delete(),
    database.subjects.where("semesterId").equals(semesterId).delete(),
    database.timetableVersions.where("semesterId").equals(semesterId).delete(),
    database.timetables.where("semesterId").equals(semesterId).delete(),
    database.uploadedTimetableReferences
      .where("semesterId")
      .equals(semesterId)
      .delete(),
    database.recentActions.where("semesterId").equals(semesterId).delete(),
  ]);
  await database.semesters.delete(semesterId);
  const settings = await database.appSettings.get("app");
  if (settings?.activeSemesterId === semesterId) {
    await database.appSettings.put({
      ...settings,
      activeSemesterId: undefined,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function resetSemester(
  database: AttendSafeDatabase,
  semesterId: string,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed)
    throw new Error("Resetting a semester requires confirmation.");
  await database.transaction("rw", TABLE_NAMES, () =>
    deleteSemesterTreeInTransaction(database, semesterId),
  );
}

export async function resetSemesterAttendance(
  database: AttendSafeDatabase,
  semesterId: string,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed)
    throw new Error("Resetting attendance requires confirmation.");
  await database.transaction(
    "rw",
    [
      database.classSessions,
      database.attendanceRecords,
      database.recentActions,
    ],
    async () => {
      const sessionIds = (
        await database.classSessions
          .where("semesterId")
          .equals(semesterId)
          .toArray()
      ).map((session) => session.id);
      if (sessionIds.length > 0) {
        await database.attendanceRecords
          .where("classSessionId")
          .anyOf(sessionIds)
          .delete();
      }
      await database.recentActions
        .where("semesterId")
        .equals(semesterId)
        .delete();
    },
  );
}

export async function deleteProfile(
  database: AttendSafeDatabase,
  profileId: string,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed) throw new Error("Deleting a profile requires confirmation.");
  await database.transaction("rw", TABLE_NAMES, async () => {
    const semesterIds = (
      await database.semesters.where("profileId").equals(profileId).toArray()
    ).map((semester) => semester.id);
    for (const semesterId of semesterIds) {
      await deleteSemesterTreeInTransaction(database, semesterId);
    }
    await Promise.all([
      database.uploadedTimetableReferences
        .where("profileId")
        .equals(profileId)
        .delete(),
      database.recentActions.where("profileId").equals(profileId).delete(),
    ]);
    await database.profiles.delete(profileId);
    const settings = await database.appSettings.get("app");
    if (settings?.activeProfileId === profileId) {
      await database.appSettings.put({
        ...settings,
        activeProfileId: undefined,
        activeSemesterId: undefined,
        selectedBatch: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  });
}

export async function resetApplication(
  database: AttendSafeDatabase,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed)
    throw new Error("Resetting AttendSafe requires confirmation.");
  await database.transaction("rw", TABLE_NAMES, async () => {
    for (const tableName of [...TABLE_NAMES].reverse()) {
      await database.table(tableName).clear();
    }
    await database.appSettings.put(defaultAppSettings());
  });
}

const CORE_SUBJECTS = [
  { code: "BEC501", name: "Digital Signal Processing", shortName: "DSP" },
  { code: "BEC502", name: "Integrated Circuits", shortName: "IC" },
  { code: "BEC503", name: "Control Systems", shortName: "CS" },
] as const;

const DEMO_DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"];

function demoSubject(
  semesterId: string,
  now: string,
  values: {
    name: string;
    shortName: string;
    code?: string;
    classType?: ClassType;
    credits?: number;
    isZeroCredit?: boolean;
  },
): Subject {
  return {
    id: createEntityId(),
    semesterId,
    code: values.code,
    name: values.name,
    shortName: values.shortName,
    credits: values.credits ?? 3,
    classType: values.classType ?? "THEORY",
    isZeroCredit: values.isZeroCredit ?? false,
    isEnabled: true,
    countsCancelledSessions: false,
    exemptPolicy: "EXCLUDED",
    initialHeld: 0,
    initialAttended: 0,
    ...entityTimestamps(now),
  };
}

export async function installGeneratedDemoData(
  database: AttendSafeDatabase,
  displayName = "Demo Student",
): Promise<ProfileSetupResult & TimetableBundle> {
  const year = new Date().getUTCFullYear();
  const setup = await createProfileSetup(database, {
    profile: { displayName, batch: "B1", timezone: "Asia/Kolkata" },
    semester: {
      name: "ECE Semester 5 Demo",
      startDate: `${year}-07-01`,
      endDate: `${year}-12-15`,
    },
  });
  const now = new Date().toISOString();
  const timetableId = createEntityId();
  const versionId = createEntityId();
  const timetable: Timetable = {
    id: timetableId,
    semesterId: setup.semester.id,
    title: "ECE Semester 5",
    timezone: setup.profile.timezone,
    ...entityTimestamps(now),
  };
  const version: TimetableVersion = {
    id: versionId,
    timetableId,
    semesterId: setup.semester.id,
    version: 1,
    label: "Demo timetable",
    effectiveStartDate: setup.semester.startDate,
    isConfirmed: true,
    source: "DEMO",
    ...entityTimestamps(now),
  };
  const core = CORE_SUBJECTS.map((subject) =>
    demoSubject(setup.semester.id, now, subject),
  );
  const cmos = demoSubject(setup.semester.id, now, {
    code: "BEC541",
    name: "CMOS Analog VLSI Design",
    shortName: "CMOS",
  });
  const optical = demoSubject(setup.semester.id, now, {
    code: "BEC542",
    name: "Optical Communication",
    shortName: "OC",
  });
  const lifeSkills = demoSubject(setup.semester.id, now, {
    code: "HSM501",
    name: "Life Skills",
    shortName: "LS",
    credits: 0,
    isZeroCredit: true,
  });
  const lab = demoSubject(setup.semester.id, now, {
    code: "BEC591",
    name: "Integrated Circuits Lab",
    shortName: "IC Lab",
    credits: 1,
    classType: "LAB",
  });
  const project = demoSubject(setup.semester.id, now, {
    code: "BEC599",
    name: "Mini Project",
    shortName: "Project",
    credits: 2,
    classType: "PROJECT",
  });
  const subjects = [...core, cmos, optical, lifeSkills, lab, project];
  const electiveGroup: ElectiveGroup = {
    id: createEntityId(),
    semesterId: setup.semester.id,
    name: "Elective II",
    options: [
      { subjectId: cmos.id, label: cmos.name },
      { subjectId: optical.id, label: optical.name },
    ],
    selectedSubjectIds: [cmos.id],
    allowMultiple: false,
    ...entityTimestamps(now),
  };
  const slots: TimetableSlot[] = [];
  const addSlot = (
    subject: Subject | undefined,
    dayOfWeek: DayOfWeek,
    startTime: string,
    endTime: string,
    extra: Partial<TimetableSlot> = {},
  ): void => {
    slots.push({
      id: createEntityId(),
      timetableVersionId: versionId,
      subjectId: subject?.id,
      dayOfWeek,
      startTime,
      endTime,
      faculty: [],
      batchRestriction: [],
      weekPattern: "EVERY_WEEK",
      isEnabled: true,
      isPlaceholder: false,
      isBreak: false,
      ...entityTimestamps(now),
      ...extra,
    });
  };
  core.forEach((subject, subjectIndex) => {
    DEMO_DAYS.forEach((day, dayIndex) => {
      const hour = 9 + ((subjectIndex + dayIndex) % 3);
      addSlot(
        subject,
        day,
        `${String(hour).padStart(2, "0")}:00`,
        `${String(hour + 1).padStart(2, "0")}:00`,
        {
          faculty: [`F${subjectIndex + 1}`],
          room: `AB-${301 + subjectIndex}`,
        },
      );
    });
  });
  ["MONDAY", "WEDNESDAY", "FRIDAY"].forEach((day) => {
    addSlot(cmos, day as DayOfWeek, "12:00", "13:00", {
      electiveGroupId: electiveGroup.id,
    });
    addSlot(optical, day as DayOfWeek, "12:00", "13:00", {
      electiveGroupId: electiveGroup.id,
    });
  });
  addSlot(lifeSkills, "FRIDAY", "14:00", "15:00");
  addSlot(lab, "TUESDAY", "14:00", "16:00", { batchRestriction: ["B1"] });
  addSlot(lab, "THURSDAY", "14:00", "16:00", { batchRestriction: ["B2"] });
  addSlot(project, "FRIDAY", "15:00", "16:00", {
    isPlaceholder: true,
    notes: "Static project placeholder — not a scheduled class",
  });

  const bundle: TimetableBundle = {
    timetable,
    version,
    subjects,
    electiveGroups: [electiveGroup],
    slots,
    activate: true,
  };
  await saveTimetableBundle(database, bundle);
  await createRepositories(database).appSettings.update({
    selectedBatch: "B1",
    trackedClassTypes: {
      THEORY: true,
      LAB: false,
      TUTORIAL: false,
      SEMINAR: false,
      PROJECT: false,
      OTHER: false,
    },
    includeZeroCredit: false,
  });
  return { ...setup, ...bundle };
}

export async function installDemoData(
  database: AttendSafeDatabase,
  displayName = "Demo Student",
): Promise<ProfileSetupResult & TimetableBundle> {
  const demo = createDemoTimetable();
  const profile: Profile = {
    ...demo.profile,
    displayName: displayName.trim() || demo.profile.displayName,
  };
  const bundle: TimetableBundle = {
    timetable: demo.timetable,
    version: demo.timetableVersion,
    subjects: demo.subjects,
    electiveGroups: demo.electiveGroups,
    slots: demo.timetableSlots,
    activate: true,
  };
  await database.transaction(
    "rw",
    [
      database.profiles,
      database.semesters,
      database.timetables,
      database.timetableVersions,
      database.subjects,
      database.electiveGroups,
      database.timetableSlots,
      database.academicExceptions,
      database.appSettings,
    ],
    async () => {
      await database.profiles.put(profile);
      await database.semesters.put(demo.semester);
      await database.timetables.put(demo.timetable);
      await database.timetableVersions.put(demo.timetableVersion);
      await database.subjects.bulkPut(demo.subjects);
      await database.electiveGroups.bulkPut(demo.electiveGroups);
      await database.timetableSlots.bulkPut(demo.timetableSlots);
      await database.academicExceptions.bulkPut(demo.academicExceptions);
      await database.appSettings.put(demo.appSettings);
    },
  );
  return {
    profile,
    semester: demo.semester,
    settings: demo.appSettings,
    ...bundle,
  };
}

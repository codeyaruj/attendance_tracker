import type { Table } from "dexie";

import type {
  AcademicException,
  AppSettings,
  AttendanceRecord,
  ClassSession,
  ElectiveGroup,
  Profile,
  RecentAction,
  Semester,
  Subject,
  Timetable,
  TimetableSlot,
  TimetableVersion,
  TimestampedEntity,
  UploadedTimetableReference,
} from "@/types/domain";

import type { AttendSafeDatabase } from "./database";
import { defaultAppSettings } from "./schema";

type IdentifiedEntity = TimestampedEntity & { id: string };

export function createEntityId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error(
      "Secure UUID generation is unavailable in this environment.",
    );
  }
  return globalThis.crypto.randomUUID();
}

export function entityTimestamps(
  now = new Date().toISOString(),
): TimestampedEntity {
  return { createdAt: now, updatedAt: now };
}

export class EntityRepository<T extends IdentifiedEntity> {
  constructor(
    protected readonly database: AttendSafeDatabase,
    readonly table: Table<T, string>,
  ) {}

  get(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async require(id: string): Promise<T> {
    const value = await this.get(id);
    if (!value)
      throw new Error(`Record ${id} was not found in ${this.table.name}.`);
    return value;
  }

  list(): Promise<T[]> {
    return this.table.toArray();
  }

  count(): Promise<number> {
    return this.table.count();
  }

  async add(value: T): Promise<T> {
    await this.table.add(value);
    return value;
  }

  async put(value: T): Promise<T> {
    await this.table.put(value);
    return value;
  }

  async bulkPut(values: readonly T[]): Promise<T[]> {
    if (values.length > 0) await this.table.bulkPut([...values]);
    return [...values];
  }

  async update(
    id: string,
    changes: Partial<Omit<T, "id" | "createdAt">>,
  ): Promise<T> {
    return this.database.transaction("rw", this.table, async () => {
      const existing = await this.require(id);
      const updated = {
        ...existing,
        ...changes,
        id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      } as T;
      await this.table.put(updated);
      return updated;
    });
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  async bulkDelete(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await this.table.bulkDelete([...ids]);
  }
}

export class ProfileRepository extends EntityRepository<Profile> {
  listByName(): Promise<Profile[]> {
    return this.table.orderBy("displayName").toArray();
  }
}

export class SemesterRepository extends EntityRepository<Semester> {
  listByProfile(profileId: string): Promise<Semester[]> {
    return this.table.where("profileId").equals(profileId).sortBy("startDate");
  }
}

export class TimetableRepository extends EntityRepository<Timetable> {
  listBySemester(semesterId: string): Promise<Timetable[]> {
    return this.table.where("semesterId").equals(semesterId).toArray();
  }
}

export class TimetableVersionRepository extends EntityRepository<TimetableVersion> {
  listBySemester(semesterId: string): Promise<TimetableVersion[]> {
    return this.table
      .where("semesterId")
      .equals(semesterId)
      .sortBy("effectiveStartDate");
  }

  listByTimetable(timetableId: string): Promise<TimetableVersion[]> {
    return this.table
      .where("timetableId")
      .equals(timetableId)
      .sortBy("version");
  }

  async getConfirmedForDate(
    semesterId: string,
    date: string,
  ): Promise<TimetableVersion | undefined> {
    const matches = (await this.listBySemester(semesterId)).filter(
      (version) =>
        version.isConfirmed &&
        version.effectiveStartDate <= date &&
        (!version.effectiveEndDate || version.effectiveEndDate >= date),
    );
    return matches.at(-1);
  }
}

export class SubjectRepository extends EntityRepository<Subject> {
  listBySemester(semesterId: string): Promise<Subject[]> {
    return this.table.where("semesterId").equals(semesterId).sortBy("name");
  }

  async listEnabled(semesterId: string): Promise<Subject[]> {
    return (await this.listBySemester(semesterId)).filter(
      (subject) => subject.isEnabled,
    );
  }
}

export class ElectiveGroupRepository extends EntityRepository<ElectiveGroup> {
  listBySemester(semesterId: string): Promise<ElectiveGroup[]> {
    return this.table.where("semesterId").equals(semesterId).toArray();
  }
}

export class TimetableSlotRepository extends EntityRepository<TimetableSlot> {
  listByVersion(timetableVersionId: string): Promise<TimetableSlot[]> {
    return this.table
      .where("timetableVersionId")
      .equals(timetableVersionId)
      .toArray();
  }

  listBySubject(subjectId: string): Promise<TimetableSlot[]> {
    return this.table.where("subjectId").equals(subjectId).toArray();
  }
}

export class AcademicExceptionRepository extends EntityRepository<AcademicException> {
  async listForDate(
    semesterId: string,
    date: string,
  ): Promise<AcademicException[]> {
    const semesterExceptions = await this.table
      .where("semesterId")
      .equals(semesterId)
      .toArray();
    return semesterExceptions.filter(
      (exception) => exception.startDate <= date && exception.endDate >= date,
    );
  }

  async listForRange(
    semesterId: string,
    startDate: string,
    endDate: string,
  ): Promise<AcademicException[]> {
    const semesterExceptions = await this.table
      .where("semesterId")
      .equals(semesterId)
      .toArray();
    return semesterExceptions.filter(
      (exception) =>
        exception.startDate <= endDate && exception.endDate >= startDate,
    );
  }
}

export class ClassSessionRepository extends EntityRepository<ClassSession> {
  listForDate(semesterId: string, date: string): Promise<ClassSession[]> {
    return this.table
      .where("[semesterId+date]")
      .equals([semesterId, date])
      .sortBy("startTime");
  }

  listForRange(
    semesterId: string,
    startDate: string,
    endDate: string,
  ): Promise<ClassSession[]> {
    return this.table
      .where("[semesterId+date]")
      .between([semesterId, startDate], [semesterId, endDate], true, true)
      .sortBy("date");
  }

  listBySubject(subjectId: string): Promise<ClassSession[]> {
    return this.table.where("subjectId").equals(subjectId).sortBy("date");
  }

  getForSlotOnDate(
    timetableSlotId: string,
    date: string,
  ): Promise<ClassSession | undefined> {
    return this.table
      .where("[timetableSlotId+date]")
      .equals([timetableSlotId, date])
      .first();
  }
}

export class AttendanceRepository extends EntityRepository<AttendanceRecord> {
  getForSession(classSessionId: string): Promise<AttendanceRecord | undefined> {
    return this.table.where("classSessionId").equals(classSessionId).first();
  }

  async listForSessions(
    classSessionIds: readonly string[],
  ): Promise<AttendanceRecord[]> {
    if (classSessionIds.length === 0) return [];
    return this.table
      .where("classSessionId")
      .anyOf([...classSessionIds])
      .toArray();
  }

  async deleteForSession(classSessionId: string): Promise<void> {
    await this.table.where("classSessionId").equals(classSessionId).delete();
  }
}

export class SettingsRepository {
  constructor(
    private readonly database: AttendSafeDatabase,
    readonly table: Table<AppSettings, AppSettings["id"]>,
  ) {}

  get(): Promise<AppSettings | undefined> {
    return this.table.get("app");
  }

  async getOrCreate(): Promise<AppSettings> {
    return this.database.transaction("rw", this.table, async () => {
      const existing = await this.get();
      if (existing) return existing;
      const settings = defaultAppSettings();
      await this.table.add(settings);
      return settings;
    });
  }

  async update(
    changes: Partial<Omit<AppSettings, "id">>,
  ): Promise<AppSettings> {
    return this.database.transaction("rw", this.table, async () => {
      const existing = (await this.get()) ?? defaultAppSettings();
      const updated: AppSettings = {
        ...existing,
        ...changes,
        id: "app",
        trackedClassTypes: changes.trackedClassTypes
          ? { ...changes.trackedClassTypes }
          : existing.trackedClassTypes,
        updatedAt: new Date().toISOString(),
      };
      await this.table.put(updated);
      return updated;
    });
  }
}

export class UploadedTimetableReferenceRepository extends EntityRepository<UploadedTimetableReference> {
  listByProfile(profileId: string): Promise<UploadedTimetableReference[]> {
    return this.table.where("profileId").equals(profileId).toArray();
  }

  listBySemester(semesterId: string): Promise<UploadedTimetableReference[]> {
    return this.table.where("semesterId").equals(semesterId).toArray();
  }
}

export class RecentActionRepository extends EntityRepository<RecentAction> {
  async listRecent(profileId: string, limit = 30): Promise<RecentAction[]> {
    return this.table
      .where("[profileId+createdAt]")
      .between([profileId, ""], [profileId, "\uffff"], true, true)
      .reverse()
      .limit(limit)
      .toArray();
  }

  async prune(profileId: string, keep = 100): Promise<number> {
    const actions = await this.table
      .where("[profileId+createdAt]")
      .between([profileId, ""], [profileId, "\uffff"], true, true)
      .reverse()
      .toArray();
    const obsoleteIds = actions.slice(keep).map((action) => action.id);
    await this.bulkDelete(obsoleteIds);
    return obsoleteIds.length;
  }
}

export class AttendSafeRepositories {
  readonly profiles: ProfileRepository;
  readonly semesters: SemesterRepository;
  readonly timetables: TimetableRepository;
  readonly timetableVersions: TimetableVersionRepository;
  readonly subjects: SubjectRepository;
  readonly electiveGroups: ElectiveGroupRepository;
  readonly timetableSlots: TimetableSlotRepository;
  readonly academicExceptions: AcademicExceptionRepository;
  readonly classSessions: ClassSessionRepository;
  readonly attendanceRecords: AttendanceRepository;
  readonly appSettings: SettingsRepository;
  readonly uploadedTimetableReferences: UploadedTimetableReferenceRepository;
  readonly recentActions: RecentActionRepository;

  constructor(readonly database: AttendSafeDatabase) {
    this.profiles = new ProfileRepository(database, database.profiles);
    this.semesters = new SemesterRepository(database, database.semesters);
    this.timetables = new TimetableRepository(database, database.timetables);
    this.timetableVersions = new TimetableVersionRepository(
      database,
      database.timetableVersions,
    );
    this.subjects = new SubjectRepository(database, database.subjects);
    this.electiveGroups = new ElectiveGroupRepository(
      database,
      database.electiveGroups,
    );
    this.timetableSlots = new TimetableSlotRepository(
      database,
      database.timetableSlots,
    );
    this.academicExceptions = new AcademicExceptionRepository(
      database,
      database.academicExceptions,
    );
    this.classSessions = new ClassSessionRepository(
      database,
      database.classSessions,
    );
    this.attendanceRecords = new AttendanceRepository(
      database,
      database.attendanceRecords,
    );
    this.appSettings = new SettingsRepository(database, database.appSettings);
    this.uploadedTimetableReferences = new UploadedTimetableReferenceRepository(
      database,
      database.uploadedTimetableReferences,
    );
    this.recentActions = new RecentActionRepository(
      database,
      database.recentActions,
    );
  }
}

const repositoryCache = new WeakMap<
  AttendSafeDatabase,
  AttendSafeRepositories
>();

export function createRepositories(
  database: AttendSafeDatabase,
): AttendSafeRepositories {
  const existing = repositoryCache.get(database);
  if (existing) return existing;
  const repositories = new AttendSafeRepositories(database);
  repositoryCache.set(database, repositories);
  return repositories;
}

import { z } from "zod";

import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  RecentAction,
} from "@/types/domain";

import type { AttendSafeDatabase } from "./database";
import { createEntityId, entityTimestamps } from "./repositories";

const attendanceRecordSchema = z.object({
  id: z.string().min(1),
  classSessionId: z.string().min(1),
  status: z.enum(["PRESENT", "ABSENT", "EXEMPT", "NOT_MARKED"]),
  markedAt: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const classSessionSchema = z.object({
  id: z.string().min(1),
  semesterId: z.string().min(1),
  subjectId: z.string().min(1),
  timetableSlotId: z.string().optional(),
  timetableVersionId: z.string().optional(),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  status: z.enum([
    "SCHEDULED",
    "HELD",
    "CANCELLED",
    "HOLIDAY",
    "RESCHEDULED",
    "EXTRA",
    "NOT_CONDUCTED",
  ]),
  source: z.enum(["TIMETABLE", "EXTRA", "RESCHEDULED"]),
  faculty: z.array(z.string()),
  room: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const restoreAttendanceSchema = z.object({
  type: z.literal("RESTORE_ATTENDANCE"),
  classSessionId: z.string().min(1),
  previous: attendanceRecordSchema.nullable(),
});

const restoreAttendanceBatchSchema = z.object({
  type: z.literal("RESTORE_ATTENDANCE_BATCH"),
  classSessionIds: z.array(z.string().min(1)),
  previous: z.array(attendanceRecordSchema),
});

const restoreSessionSchema = z.object({
  type: z.literal("RESTORE_SESSION"),
  classSessionId: z.string().min(1),
  previous: classSessionSchema.nullable(),
});

const undoPayloadSchema = z.discriminatedUnion("type", [
  restoreAttendanceSchema,
  restoreAttendanceBatchSchema,
  restoreSessionSchema,
]);

export type UndoPayload = z.infer<typeof undoPayloadSchema>;

function toUndoRecord(payload: UndoPayload): Record<string, unknown> {
  return { ...payload };
}

async function profileForSession(
  database: AttendSafeDatabase,
  session: ClassSession,
): Promise<string> {
  const semester = await database.semesters.get(session.semesterId);
  if (!semester) {
    throw new Error(`Semester ${session.semesterId} does not exist.`);
  }
  return semester.profileId;
}

function createAction(
  profileId: string,
  semesterId: string,
  description: string,
  payload: UndoPayload,
  now: string,
): RecentAction {
  return {
    id: createEntityId(),
    profileId,
    semesterId,
    kind: payload.type,
    description,
    undoPayload: toUndoRecord(payload),
    ...entityTimestamps(now),
  };
}

export async function markAttendanceWithUndo(
  database: AttendSafeDatabase,
  classSessionId: string,
  status: AttendanceStatus,
  notes?: string,
  description = `Marked attendance ${status.toLowerCase()}`,
): Promise<AttendanceRecord> {
  return database.transaction(
    "rw",
    [
      database.semesters,
      database.classSessions,
      database.attendanceRecords,
      database.recentActions,
    ],
    async () => {
      const session = await database.classSessions.get(classSessionId);
      if (!session)
        throw new Error(`Class session ${classSessionId} does not exist.`);
      const profileId = await profileForSession(database, session);
      const previous = await database.attendanceRecords
        .where("classSessionId")
        .equals(classSessionId)
        .first();
      const now = new Date().toISOString();
      const record: AttendanceRecord = {
        id: previous?.id ?? createEntityId(),
        classSessionId,
        status,
        markedAt: now,
        notes,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      await database.attendanceRecords.put(record);
      await database.recentActions.add(
        createAction(
          profileId,
          session.semesterId,
          description,
          {
            type: "RESTORE_ATTENDANCE",
            classSessionId,
            previous: previous ?? null,
          },
          now,
        ),
      );
      return record;
    },
  );
}

export interface BulkAttendanceChange {
  classSessionId: string;
  status: AttendanceStatus;
  notes?: string;
}

export async function bulkMarkAttendanceWithUndo(
  database: AttendSafeDatabase,
  changes: readonly BulkAttendanceChange[],
  description = "Updated attendance in bulk",
): Promise<AttendanceRecord[]> {
  if (changes.length === 0) return [];
  const uniqueSessionIds = [
    ...new Set(changes.map((change) => change.classSessionId)),
  ];
  if (uniqueSessionIds.length !== changes.length) {
    throw new Error(
      "A bulk attendance update cannot contain the same session twice.",
    );
  }

  return database.transaction(
    "rw",
    [
      database.semesters,
      database.classSessions,
      database.attendanceRecords,
      database.recentActions,
    ],
    async () => {
      const sessions = await database.classSessions.bulkGet(uniqueSessionIds);
      if (sessions.some((session) => !session)) {
        throw new Error("One or more class sessions no longer exist.");
      }
      const existing = await database.attendanceRecords
        .where("classSessionId")
        .anyOf(uniqueSessionIds)
        .toArray();
      const previousBySession = new Map(
        existing.map((record) => [record.classSessionId, record]),
      );
      const now = new Date().toISOString();
      const records = changes.map((change) => {
        const previous = previousBySession.get(change.classSessionId);
        return {
          id: previous?.id ?? createEntityId(),
          classSessionId: change.classSessionId,
          status: change.status,
          markedAt: now,
          notes: change.notes,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        } satisfies AttendanceRecord;
      });
      const firstSession = sessions[0];
      if (!firstSession) throw new Error("No class session was provided.");
      const semesterId = firstSession.semesterId;
      if (sessions.some((session) => session?.semesterId !== semesterId)) {
        throw new Error(
          "A bulk attendance action must belong to one semester.",
        );
      }
      const profileId = await profileForSession(database, firstSession);
      await database.attendanceRecords.bulkPut(records);
      await database.recentActions.add(
        createAction(
          profileId,
          semesterId,
          description,
          {
            type: "RESTORE_ATTENDANCE_BATCH",
            classSessionIds: uniqueSessionIds,
            previous: existing,
          },
          now,
        ),
      );
      return records;
    },
  );
}

export async function upsertSessionWithUndo(
  database: AttendSafeDatabase,
  session: ClassSession,
  description = "Updated class session",
): Promise<ClassSession> {
  return database.transaction(
    "rw",
    [database.semesters, database.classSessions, database.recentActions],
    async () => {
      const previous = await database.classSessions.get(session.id);
      const profileId = await profileForSession(database, session);
      const now = new Date().toISOString();
      const value: ClassSession = {
        ...session,
        createdAt: previous?.createdAt ?? session.createdAt ?? now,
        updatedAt: now,
      };
      await database.classSessions.put(value);
      await database.recentActions.add(
        createAction(
          profileId,
          session.semesterId,
          description,
          {
            type: "RESTORE_SESSION",
            classSessionId: session.id,
            previous: previous ?? null,
          },
          now,
        ),
      );
      return value;
    },
  );
}

export async function undoRecentAction(
  database: AttendSafeDatabase,
  actionId: string,
): Promise<RecentAction> {
  return database.transaction(
    "rw",
    [
      database.attendanceRecords,
      database.classSessions,
      database.recentActions,
    ],
    async () => {
      const action = await database.recentActions.get(actionId);
      if (!action) throw new Error(`Recent action ${actionId} does not exist.`);
      if (action.undoneAt)
        throw new Error("This action has already been undone.");
      const result = undoPayloadSchema.safeParse(action.undoPayload);
      if (!result.success) {
        throw new Error(
          "This action cannot be undone because its undo data is invalid.",
        );
      }

      const payload = result.data;
      switch (payload.type) {
        case "RESTORE_ATTENDANCE":
          await database.attendanceRecords
            .where("classSessionId")
            .equals(payload.classSessionId)
            .delete();
          if (payload.previous) {
            await database.attendanceRecords.put(payload.previous);
          }
          break;
        case "RESTORE_ATTENDANCE_BATCH":
          await database.attendanceRecords
            .where("classSessionId")
            .anyOf(payload.classSessionIds)
            .delete();
          if (payload.previous.length > 0) {
            await database.attendanceRecords.bulkPut(payload.previous);
          }
          break;
        case "RESTORE_SESSION":
          if (payload.previous) {
            await database.classSessions.put(payload.previous);
          } else {
            await database.classSessions.delete(payload.classSessionId);
          }
          break;
      }

      const now = new Date().toISOString();
      const updated: RecentAction = {
        ...action,
        undoneAt: now,
        updatedAt: now,
      };
      await database.recentActions.put(updated);
      return updated;
    },
  );
}

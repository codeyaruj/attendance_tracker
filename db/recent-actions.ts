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

const restoreHistoricalAttendanceSchema = z.object({
  type: z.literal("RESTORE_HISTORICAL_ATTENDANCE"),
  sessions: z.array(
    z.object({
      classSessionId: z.string().min(1),
      previous: classSessionSchema.nullable(),
    }),
  ),
  attendance: z.array(
    z.object({
      classSessionId: z.string().min(1),
      previous: attendanceRecordSchema.nullable(),
    }),
  ),
});

const undoPayloadSchema = z.discriminatedUnion("type", [
  restoreAttendanceSchema,
  restoreAttendanceBatchSchema,
  restoreSessionSchema,
  restoreHistoricalAttendanceSchema,
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

export type MarkAttendanceStatus =
  AttendanceStatus | "CANCELLED" | "NOT_CONDUCTED";

export interface HistoricalAttendanceChange {
  session: ClassSession;
  status: MarkAttendanceStatus;
  notes?: string;
}

export interface HistoricalAttendanceMutationResult {
  changedCount: number;
  attendanceRecords: AttendanceRecord[];
}

function activeSessionStatus(
  session: Pick<ClassSession, "source" | "status">,
): ClassSession["status"] {
  if (
    session.status === "SCHEDULED" ||
    session.status === "HELD" ||
    session.status === "EXTRA" ||
    session.status === "RESCHEDULED"
  ) {
    return session.status;
  }
  if (session.source === "EXTRA") return "EXTRA";
  if (session.source === "RESCHEDULED") return "RESCHEDULED";
  return "SCHEDULED";
}

function sameOptionalText(left?: string, right?: string): boolean {
  return (left ?? "") === (right ?? "");
}

export async function applyHistoricalAttendanceWithUndo(
  database: AttendSafeDatabase,
  changes: readonly HistoricalAttendanceChange[],
  options: { maximumDate: string; description?: string },
): Promise<HistoricalAttendanceMutationResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.maximumDate)) {
    throw new Error("The maximum backfill date must use YYYY-MM-DD.");
  }
  if (changes.length === 0) {
    return { changedCount: 0, attendanceRecords: [] };
  }
  const sessionIds = changes.map((change) => change.session.id);
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error("A backfill update cannot contain the same session twice.");
  }
  if (changes.some((change) => change.session.date > options.maximumDate)) {
    throw new Error("Future attendance cannot be changed.");
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
      const previousSessions = await database.classSessions.bulkGet(sessionIds);
      const previousRecords = await database.attendanceRecords
        .where("classSessionId")
        .anyOf(sessionIds)
        .toArray();
      const previousRecordBySession = new Map(
        previousRecords.map((record) => [record.classSessionId, record]),
      );
      const semesterIds = [
        ...new Set(changes.map(({ session }) => session.semesterId)),
      ];
      if (semesterIds.length !== 1) {
        throw new Error("A backfill action must belong to one semester.");
      }
      const semester = await database.semesters.get(semesterIds[0]!);
      if (!semester) throw new Error("The selected semester no longer exists.");
      if (
        changes.some(
          ({ session }) =>
            session.date < semester.startDate ||
            session.date > semester.endDate,
        )
      ) {
        throw new Error("Backfill attendance must stay inside the semester.");
      }

      const now = new Date().toISOString();
      const sessionsToPut: ClassSession[] = [];
      const recordsToPut: AttendanceRecord[] = [];
      const recordIdsToDelete: string[] = [];
      const sessionRestores: Array<{
        classSessionId: string;
        previous: ClassSession | null;
      }> = [];
      const attendanceRestores: Array<{
        classSessionId: string;
        previous: AttendanceRecord | null;
      }> = [];

      changes.forEach((change, index) => {
        const previousSession = previousSessions[index];
        const previousRecord = previousRecordBySession.get(change.session.id);
        const attendanceStatus =
          change.status === "PRESENT" ||
          change.status === "ABSENT" ||
          change.status === "EXEMPT"
            ? change.status
            : undefined;
        const desiredSessionStatus =
          change.status === "CANCELLED" || change.status === "NOT_CONDUCTED"
            ? change.status
            : activeSessionStatus(previousSession ?? change.session);
        const isExceptionalChange =
          change.status === "CANCELLED" || change.status === "NOT_CONDUCTED";
        const shouldMaterialise =
          Boolean(previousSession) || change.status !== "NOT_MARKED";
        const desiredSession = shouldMaterialise
          ? {
              ...(previousSession ?? change.session),
              status: desiredSessionStatus,
              ...(isExceptionalChange && change.notes
                ? { notes: change.notes }
                : {}),
              createdAt:
                previousSession?.createdAt ?? change.session.createdAt ?? now,
              updatedAt: now,
            }
          : undefined;
        const sessionChanged = Boolean(
          desiredSession &&
          (!previousSession ||
            previousSession.status !== desiredSession.status ||
            (isExceptionalChange &&
              Boolean(change.notes) &&
              !sameOptionalText(previousSession.notes, change.notes))),
        );

        const recordChanged = attendanceStatus
          ? !previousRecord ||
            previousRecord.status !== attendanceStatus ||
            !sameOptionalText(previousRecord.notes, change.notes)
          : Boolean(previousRecord);
        if (!sessionChanged && !recordChanged) return;

        if (sessionChanged && desiredSession) {
          sessionsToPut.push(desiredSession);
          sessionRestores.push({
            classSessionId: change.session.id,
            previous: previousSession ?? null,
          });
        }
        attendanceRestores.push({
          classSessionId: change.session.id,
          previous: previousRecord ?? null,
        });
        if (attendanceStatus) {
          recordsToPut.push({
            id: previousRecord?.id ?? createEntityId(),
            classSessionId: change.session.id,
            status: attendanceStatus,
            markedAt: now,
            ...(change.notes ? { notes: change.notes } : {}),
            createdAt: previousRecord?.createdAt ?? now,
            updatedAt: now,
          });
        } else if (previousRecord) {
          recordIdsToDelete.push(previousRecord.id);
        }
      });

      const changedSessionIds = new Set([
        ...sessionRestores.map(({ classSessionId }) => classSessionId),
        ...attendanceRestores.map(({ classSessionId }) => classSessionId),
      ]);
      if (changedSessionIds.size === 0) {
        return { changedCount: 0, attendanceRecords: [] };
      }

      if (sessionsToPut.length)
        await database.classSessions.bulkPut(sessionsToPut);
      if (recordIdsToDelete.length) {
        await database.attendanceRecords.bulkDelete(recordIdsToDelete);
      }
      if (recordsToPut.length)
        await database.attendanceRecords.bulkPut(recordsToPut);
      const profileId = await profileForSession(database, changes[0]!.session);
      await database.recentActions.add(
        createAction(
          profileId,
          semester.id,
          options.description ?? "Updated historical attendance",
          {
            type: "RESTORE_HISTORICAL_ATTENDANCE",
            sessions: sessionRestores,
            attendance: attendanceRestores,
          },
          now,
        ),
      );
      return {
        changedCount: changedSessionIds.size,
        attendanceRecords: recordsToPut,
      };
    },
  );
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
        case "RESTORE_HISTORICAL_ATTENDANCE":
          for (const item of payload.attendance) {
            await database.attendanceRecords
              .where("classSessionId")
              .equals(item.classSessionId)
              .delete();
            if (item.previous) {
              await database.attendanceRecords.put(item.previous);
            }
          }
          for (const item of payload.sessions) {
            if (item.previous) {
              await database.classSessions.put(item.previous);
            } else {
              await database.classSessions.delete(item.classSessionId);
            }
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

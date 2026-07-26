import { toClassSession } from "@/components/attendance/attendance-view-model";
import { attendSafeRepository, db } from "@/db";
import type { ResolvedSession } from "@/types/domain";

export async function persistPlannedAbsences(
  sessions: readonly ResolvedSession[],
): Promise<number> {
  if (sessions.length === 0) return 0;
  const ids = sessions.map((session) => session.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A planned absence cannot contain the same class twice.");
  }
  if (
    sessions.some((session) => session.semesterId !== sessions[0].semesterId)
  ) {
    throw new Error("A planned absence set must belong to one semester.");
  }

  await db.transaction(
    "rw",
    [db.semesters, db.classSessions, db.attendanceRecords, db.recentActions],
    async () => {
      const existing = await db.classSessions.bulkGet(ids);
      const missing = sessions.flatMap((session, index) =>
        existing[index] ? [] : [toClassSession(session)],
      );
      if (missing.length > 0) await db.classSessions.bulkPut(missing);
      await attendSafeRepository.bulkMarkAttendance(
        sessions.map((session) => ({
          classSessionId: session.id,
          status: "ABSENT" as const,
          notes: "Planned in Skip Planner",
        })),
        `Planned ${sessions.length} ${sessions.length === 1 ? "absence" : "absences"}`,
      );
    },
  );
  return sessions.length;
}

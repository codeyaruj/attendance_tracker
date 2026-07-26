import { attendSafeRepository, db } from "@/db";
import type { ClassSession, ResolvedSession } from "@/types/domain";

import { toClassSession } from "./attendance-view-model";

export interface SessionDetailsOverrideValues {
  faculty: string;
  room: string;
  notes: string;
}

export function applySessionDetailsOverride(
  session: ClassSession,
  values: SessionDetailsOverrideValues,
  updatedAt = new Date().toISOString(),
): ClassSession {
  const faculty = values.faculty
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const room = values.room.trim();
  const notes = values.notes.trim();
  if (faculty.length === 0 && !room) {
    throw new Error("Enter a new room or faculty.");
  }
  return {
    ...session,
    faculty: faculty.length > 0 ? faculty : session.faculty,
    ...(room ? { room } : {}),
    ...(notes ? { notes } : {}),
    updatedAt,
  };
}

export function activeStatusForSession(
  session: Pick<ResolvedSession, "source">,
): ClassSession["status"] {
  if (session.source === "EXTRA") return "EXTRA";
  if (session.source === "RESCHEDULED") return "RESCHEDULED";
  return "SCHEDULED";
}

export async function ensureResolvedSessionExists(
  session: ResolvedSession,
): Promise<void> {
  if (!(await db.classSessions.get(session.id))) {
    await db.classSessions.put(toClassSession(session));
  }
}

export async function restoreResolvedSession(
  session: ResolvedSession,
  description = "Restored a class",
): Promise<void> {
  await attendSafeRepository.upsertSession(
    { ...toClassSession(session), status: activeStatusForSession(session) },
    description,
  );
}

"use client";

import { AlertTriangle, ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import {
  countExactDuplicateSlots,
  findDraftConflictSlotIds,
} from "@/lib/timetable";
import {
  CLASS_TYPES,
  DAYS_OF_WEEK,
  type ClassType,
  type DayOfWeek,
  type DraftSlot,
  type DraftSubject,
} from "@/types";

interface SessionDraft {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
}

function titleCase(value: string): string {
  return value[0] + value.slice(1).toLowerCase();
}

function defaultSession(dayOfWeek: DayOfWeek): SessionDraft {
  return {
    id: crypto.randomUUID(),
    dayOfWeek,
    startTime: "09:00",
    endTime: "10:00",
  };
}

function initialSessions(
  dayOfWeek: DayOfWeek = "MONDAY",
  startTime?: string,
): SessionDraft[] {
  const session = defaultSession(dayOfWeek);
  if (startTime) {
    session.startTime = startTime;
    const [hour, minute] = startTime.split(":").map(Number);
    session.endTime = `${String(Math.min(23, hour + 1)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return [session];
}

export function AddSubjectDialog({
  open,
  subjects,
  existingSlots,
  initialDay,
  initialStart,
  onClose,
  onSave,
}: {
  open: boolean;
  subjects: DraftSubject[];
  existingSlots: DraftSlot[];
  initialDay?: DayOfWeek;
  initialStart?: string;
  onClose: () => void;
  onSave: (subject: DraftSubject, slots: DraftSlot[]) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [subjectId, setSubjectId] = useState("NEW");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [faculty, setFaculty] = useState("");
  const [room, setRoom] = useState("");
  const [classType, setClassType] = useState<ClassType>("THEORY");
  const [notes, setNotes] = useState("");
  const [sessions, setSessions] = useState<SessionDraft[]>(() =>
    initialSessions(initialDay, initialStart),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setPreviewing(false);
      setSubjectId("NEW");
      setName("");
      setCode("");
      setFaculty("");
      setRoom("");
      setClassType("THEORY");
      setNotes("");
      setSessions(initialSessions(initialDay, initialStart));
      setError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialDay, initialStart, open]);

  const selectedSubject = subjects.find(
    (subject) => subject.temporaryId === subjectId,
  );
  const parsedFaculty = useMemo(
    () =>
      faculty
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [faculty],
  );
  const subject: DraftSubject = {
    temporaryId: selectedSubject?.temporaryId ?? "preview-subject",
    name: name.trim(),
    code: code.trim() || undefined,
    shortName:
      selectedSubject?.shortName ||
      code.trim() ||
      name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 5)
        .toUpperCase(),
    credits: selectedSubject?.credits ?? 3,
    classType,
    faculty: parsedFaculty,
    isZeroCredit: selectedSubject?.isZeroCredit ?? false,
    confidence: selectedSubject?.confidence ?? 1,
  };
  const candidateSlots = useMemo<DraftSlot[]>(
    () =>
      sessions.map((session) => ({
        temporaryId: session.id,
        subjectTemporaryId: subject.temporaryId,
        dayOfWeek: session.dayOfWeek,
        startTime: session.startTime,
        endTime: session.endTime,
        faculty: parsedFaculty,
        room: room.trim() || undefined,
        classType,
        batchOptions: [],
        weekPattern: "EVERY_WEEK",
        notes: notes.trim() || undefined,
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      })),
    // Primitive dependencies intentionally make the preview deterministic.
    [classType, notes, parsedFaculty, room, sessions, subject.temporaryId],
  );
  const conflictIds = useMemo(
    () => findDraftConflictSlotIds([...existingSlots, ...candidateSlots]),
    [candidateSlots, existingSlots],
  );
  const candidateConflicts = candidateSlots.filter((slot) =>
    conflictIds.has(slot.temporaryId),
  );
  const duplicateCount =
    countExactDuplicateSlots([...existingSlots, ...candidateSlots]) -
    countExactDuplicateSlots(existingSlots);

  const resetAndClose = () => {
    setPreviewing(false);
    setError("");
    onClose();
  };

  const toggleDay = (day: DayOfWeek) => {
    setSessions((current) => {
      const onDay = current.filter((session) => session.dayOfWeek === day);
      if (onDay.length)
        return current.filter((session) => session.dayOfWeek !== day);
      return [...current, defaultSession(day)].sort(
        (left, right) =>
          DAYS_OF_WEEK.indexOf(left.dayOfWeek) -
          DAYS_OF_WEEK.indexOf(right.dayOfWeek),
      );
    });
  };

  const validate = () => {
    if (!name.trim()) return "Add a subject name.";
    if (!sessions.length) return "Select at least one weekday.";
    if (sessions.some((session) => session.endTime <= session.startTime)) {
      return "Every session must end after it starts.";
    }
    if (candidateConflicts.length || duplicateCount) {
      return "Resolve the overlapping or duplicate sessions before continuing.";
    }
    return "";
  };

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title={previewing ? "Weekly preview" : "Add Subject"}
      description={
        previewing
          ? "Check each recurring session before adding it to the timetable."
          : "Create one subject, then give every selected day its own timing."
      }
    >
      {previewing ? (
        <div className="grid gap-5" data-testid="subject-weekly-preview">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-extrabold">{subject.name}</h3>
              {subject.code ? <Badge tone="info">{subject.code}</Badge> : null}
              <Badge>{titleCase(classType)}</Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {parsedFaculty.join(", ") || "Faculty not set"}
              {room.trim() ? ` · ${room.trim()}` : ""}
            </p>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {candidateSlots
              .slice()
              .sort(
                (left, right) =>
                  DAYS_OF_WEEK.indexOf(left.dayOfWeek) -
                    DAYS_OF_WEEK.indexOf(right.dayOfWeek) ||
                  left.startTime.localeCompare(right.startTime),
              )
              .map((slot) => (
                <Card key={slot.temporaryId} className="border-primary/25 p-4">
                  <p className="text-primary text-xs font-bold tracking-wider uppercase">
                    {titleCase(slot.dayOfWeek)}
                  </p>
                  <p className="mt-1 text-lg font-extrabold">
                    {slot.startTime}–{slot.endTime}
                  </p>
                </Card>
              ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={resetAndClose}>
              Back to timetable
            </Button>
            <Button variant="outline" onClick={() => setPreviewing(false)}>
              <ArrowLeft className="size-4" /> Edit
            </Button>
            <Button
              data-testid="confirm-add-subject"
              onClick={() => {
                const subjectId =
                  selectedSubject?.temporaryId ?? crypto.randomUUID();
                onSave(
                  { ...subject, temporaryId: subjectId },
                  candidateSlots.map((slot) => ({
                    ...slot,
                    temporaryId: crypto.randomUUID(),
                    subjectTemporaryId: subjectId,
                  })),
                );
                resetAndClose();
              }}
            >
              <Check className="size-4" /> Confirm subject
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6" data-testid="add-subject-form">
          <section className="grid gap-4">
            <div>
              <p className="text-primary text-xs font-bold tracking-wider uppercase">
                1 · Subject details
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Shared details apply to every session below.
              </p>
            </div>
            {subjects.length ? (
              <Field label="Use an existing subject">
                <Select
                  value={subjectId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSubjectId(nextId);
                    const next = subjects.find(
                      (item) => item.temporaryId === nextId,
                    );
                    if (next) {
                      setName(next.name);
                      setCode(next.code ?? "");
                      setFaculty(next.faculty.join(", "));
                      setClassType(next.classType);
                    }
                  }}
                >
                  <option value="NEW">Create a new subject</option>
                  {subjects.map((item) => (
                    <option key={item.temporaryId} value={item.temporaryId}>
                      {item.name}
                      {item.code ? ` · ${item.code}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Subject name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Digital Signal Processing"
                />
              </Field>
              <Field label="Subject code" hint="Optional">
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="BEC503"
                />
              </Field>
              <Field
                label="Faculty"
                hint="Optional; separate names with commas"
              >
                <Input
                  value={faculty}
                  onChange={(event) => setFaculty(event.target.value)}
                  placeholder="PJ, AK"
                />
              </Field>
              <Field label="Room" hint="Optional">
                <Input
                  value={room}
                  onChange={(event) => setRoom(event.target.value)}
                  placeholder="AB-304"
                />
              </Field>
              <Field label="Class type">
                <Select
                  value={classType}
                  onChange={(event) =>
                    setClassType(event.target.value as ClassType)
                  }
                >
                  {CLASS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {titleCase(type)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>

          <section className="grid gap-3">
            <div>
              <p className="text-primary text-xs font-bold tracking-wider uppercase">
                2 · Select days
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Choose any number of weekdays.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DAYS_OF_WEEK.map((day) => {
                const checked = sessions.some(
                  (session) => session.dayOfWeek === day,
                );
                return (
                  <label
                    key={day}
                    className="bg-secondary flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDay(day)}
                      className="accent-primary size-4"
                    />
                    {titleCase(day).slice(0, 3)}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3">
            <div>
              <p className="text-primary text-xs font-bold tracking-wider uppercase">
                3 · Configure each day
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Start and end times are independent. Longer ranges automatically
                create longer blocks.
              </p>
            </div>
            {DAYS_OF_WEEK.filter((day) =>
              sessions.some((session) => session.dayOfWeek === day),
            ).map((day) => (
              <Card key={day} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-extrabold">{titleCase(day)}</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSessions((current) => [
                        ...current,
                        defaultSession(day),
                      ])
                    }
                  >
                    <Plus className="size-4" /> Add another session
                  </Button>
                </div>
                <div className="mt-3 grid gap-3">
                  {sessions
                    .filter((session) => session.dayOfWeek === day)
                    .map((session, index) => (
                      <div
                        key={session.id}
                        className="bg-secondary/60 grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-xl p-3"
                      >
                        <Field
                          label={
                            index === 0
                              ? "Starts"
                              : `Session ${index + 1} starts`
                          }
                        >
                          <Input
                            type="time"
                            value={session.startTime}
                            onChange={(event) =>
                              setSessions((current) =>
                                current.map((item) =>
                                  item.id === session.id
                                    ? { ...item, startTime: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Field label="Ends">
                          <Input
                            type="time"
                            value={session.endTime}
                            onChange={(event) =>
                              setSessions((current) =>
                                current.map((item) =>
                                  item.id === session.id
                                    ? { ...item, endTime: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                        {index > 0 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${titleCase(day)} session ${index + 1}`}
                            onClick={() =>
                              setSessions((current) =>
                                current.filter(
                                  (item) => item.id !== session.id,
                                ),
                              )
                            }
                          >
                            <Trash2 className="text-danger size-4" />
                          </Button>
                        ) : (
                          <span className="size-10" />
                        )}
                      </div>
                    ))}
                </div>
              </Card>
            ))}
          </section>

          <Field label="Notes" hint="Optional">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          {candidateConflicts.length || duplicateCount ? (
            <div className="bg-danger-soft text-danger flex gap-2 rounded-xl p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              These sessions overlap or duplicate an existing class. Adjust the
              highlighted schedule before continuing.
            </div>
          ) : null}
          {error ? (
            <p className="text-danger text-sm font-semibold" role="alert">
              {error}
            </p>
          ) : null}
          <div className="border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button
              data-testid="preview-subject"
              onClick={() => {
                const message = validate();
                setError(message);
                if (!message) setPreviewing(true);
              }}
            >
              Preview week
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

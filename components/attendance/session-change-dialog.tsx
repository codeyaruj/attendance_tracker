"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import type { ResolvedSession, Subject } from "@/types/domain";

export type SessionChangeKind =
  "EXTRA" | "RESCHEDULE" | "CANCELLATION" | "OVERRIDE";

export interface SessionChangeValues {
  kind: SessionChangeKind;
  subjectId: string;
  sourceSessionId: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string;
  faculty: string;
  notes: string;
}

export function SessionChangeDialog({
  open,
  date,
  subjects,
  sessions,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  date: string;
  subjects: readonly Subject[];
  sessions: readonly ResolvedSession[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: SessionChangeValues) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<SessionChangeValues>({
    defaultValues: {
      kind: "EXTRA",
      subjectId: subjects[0]?.id ?? "",
      sourceSessionId: sessions[0]?.id ?? "",
      date,
      startTime: "09:00",
      endTime: "10:00",
      room: "",
      faculty: "",
      notes: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const sourceSessionId = useWatch({ control, name: "sourceSessionId" });
  const selectedSession = sessions.find(
    (session) => session.id === sourceSessionId,
  );

  useEffect(() => {
    if (!open) return;
    reset({
      kind: "EXTRA",
      subjectId: subjects[0]?.id ?? "",
      sourceSessionId: sessions[0]?.id ?? "",
      date,
      startTime: sessions[0]?.startTime ?? "09:00",
      endTime: sessions[0]?.endTime ?? "10:00",
      room: "",
      faculty: "",
      notes: "",
    });
  }, [date, open, reset, sessions, subjects]);

  const requiresSource =
    kind === "RESCHEDULE" || kind === "CANCELLATION" || kind === "OVERRIDE";

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add a timetable change"
      description="Record an extra class, move or cancel one occurrence, or update its room and faculty."
    >
      <form
        className="grid gap-4"
        onSubmit={handleSubmit((values) => void onSubmit(values))}
        data-testid="session-change-form"
      >
        <Field label="Change type">
          <Select {...register("kind")}>
            <option value="EXTRA">Extra class</option>
            <option value="RESCHEDULE">Rescheduled class</option>
            <option value="CANCELLATION">One-off cancellation</option>
            <option value="OVERRIDE">Change room or faculty</option>
          </Select>
        </Field>

        {requiresSource ? (
          <Field label="Class" error={errors.sourceSessionId?.message}>
            <Select
              {...register("sourceSessionId", {
                required: "Choose the class to change.",
              })}
            >
              {sessions.length === 0 ? (
                <option value="">No classes on this date</option>
              ) : null}
              {sessions.map((session) => {
                const subject = subjects.find(
                  (candidate) => candidate.id === session.subjectId,
                );
                return (
                  <option key={session.id} value={session.id}>
                    {session.startTime} ·{" "}
                    {subject?.shortName ?? subject?.name ?? "Class"}
                  </option>
                );
              })}
            </Select>
          </Field>
        ) : (
          <Field label="Subject" error={errors.subjectId?.message}>
            <Select
              {...register("subjectId", {
                required: "Choose a subject.",
              })}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                  {subject.code ? ` (${subject.code})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === "EXTRA" ||
        kind === "RESCHEDULE" ||
        kind === "CANCELLATION" ? (
          <>
            <Field
              label={
                kind === "RESCHEDULE"
                  ? "New date"
                  : kind === "CANCELLATION"
                    ? "Cancellation date"
                    : "Date"
              }
              error={errors.date?.message}
            >
              <Input
                type="date"
                {...register("date", { required: "Choose a date." })}
              />
            </Field>
            {kind !== "CANCELLATION" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts" error={errors.startTime?.message}>
                  <Input
                    type="time"
                    {...register("startTime", {
                      required: "Add a start time.",
                    })}
                  />
                </Field>
                <Field label="Ends" error={errors.endTime?.message}>
                  <Input
                    type="time"
                    {...register("endTime", {
                      required: "Add an end time.",
                      validate: (value, values) =>
                        value > values.startTime || "End time must be later.",
                    })}
                  />
                </Field>
              </div>
            ) : null}
            {kind !== "CANCELLATION" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Faculty"
                  hint="Separate multiple names with commas."
                >
                  <Input
                    placeholder="e.g. Prof. Rao"
                    {...register("faculty")}
                  />
                </Field>
                <Field label="Room">
                  <Input placeholder="e.g. AB-304" {...register("room")} />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}

        {kind === "OVERRIDE" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Faculty"
              hint="Leave blank to keep the current faculty. Separate multiple names with commas."
            >
              <Input
                placeholder={selectedSession?.faculty.join(", ") || "Faculty"}
                {...register("faculty")}
              />
            </Field>
            <Field label="Room" hint="Leave blank to keep the current room.">
              <Input
                placeholder={selectedSession?.room || "Room"}
                {...register("room")}
              />
            </Field>
          </div>
        ) : null}

        <Field label="Note">
          <Textarea
            className="min-h-20"
            placeholder="Optional context for this change"
            {...register("notes")}
          />
        </Field>

        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              subjects.length === 0 ||
              (requiresSource && sessions.length === 0)
            }
          >
            {busy
              ? "Saving…"
              : kind === "CANCELLATION"
                ? "Cancel class"
                : kind === "OVERRIDE"
                  ? "Save class details"
                  : "Save change"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

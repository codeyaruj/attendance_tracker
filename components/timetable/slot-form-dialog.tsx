"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { minutesToTime, timeToMinutes } from "@/lib/timetable";
import type { DraftSlotEditScope } from "@/lib/timetable";
import { CLASS_TYPES, DAYS_OF_WEEK, WEEK_PATTERNS } from "@/types";
import type { DraftSlot, DraftSubject } from "@/types";

const slotFormSchema = z
  .object({
    subjectTemporaryId: z.string(),
    subjectName: z.string().trim(),
    subjectCode: z.string().trim(),
    shortName: z.string().trim(),
    credits: z.coerce.number().min(0).max(30),
    dayOfWeek: z.enum(DAYS_OF_WEEK),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Choose an end time"),
    faculty: z.string(),
    room: z.string(),
    classType: z.enum(CLASS_TYPES),
    isZeroCredit: z.boolean(),
    batchRestriction: z.string(),
    electiveGroup: z.string(),
    weekPattern: z.enum(WEEK_PATTERNS),
    customWeekPattern: z.string(),
    notes: z.string(),
    isPlaceholder: z.boolean(),
    isBreak: z.boolean(),
    isEnabled: z.boolean(),
    editScope: z.enum(["ONE_SESSION", "WEEKDAY_SUBJECT", "ALL_SUBJECT"]),
  })
  .superRefine((values, context) => {
    if (!values.isBreak && !values.subjectName) {
      context.addIssue({
        code: "custom",
        message: "Subject name is required",
        path: ["subjectName"],
      });
    }
    if (values.isBreak && values.isPlaceholder) {
      context.addIssue({
        code: "custom",
        message: "Choose either break or placeholder",
        path: ["isPlaceholder"],
      });
    }
  })
  .refine((values) => values.endTime > values.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });

type SlotFormValues = z.infer<typeof slotFormSchema>;
type SlotFormInput = z.input<typeof slotFormSchema>;

function valuesFor(subjects: DraftSubject[], slot?: DraftSlot): SlotFormValues {
  const subject = subjects.find(
    (item) => item.temporaryId === slot?.subjectTemporaryId,
  );
  return {
    subjectTemporaryId: subject?.temporaryId ?? "NEW",
    subjectName: subject?.name ?? "",
    subjectCode: subject?.code ?? "",
    shortName: subject?.shortName ?? "",
    credits: subject?.credits ?? 3,
    dayOfWeek: slot?.dayOfWeek ?? "MONDAY",
    startTime: slot?.startTime ?? "09:00",
    endTime: slot?.endTime ?? "10:00",
    faculty: slot?.faculty.join(", ") ?? "",
    room: slot?.room ?? "",
    classType: slot?.classType ?? subject?.classType ?? "THEORY",
    isZeroCredit: subject?.isZeroCredit ?? false,
    batchRestriction: slot?.batchOptions.join(", ") ?? "",
    electiveGroup: slot?.electiveGroupId ?? "",
    weekPattern: slot?.weekPattern ?? "EVERY_WEEK",
    customWeekPattern: slot?.customWeekPattern ?? "",
    notes: slot?.notes ?? "",
    isPlaceholder: slot?.isPlaceholder ?? false,
    isBreak: slot?.isBreak ?? false,
    isEnabled: slot?.isEnabled ?? true,
    editScope: "ONE_SESSION",
  };
}

export function SlotFormDialog({
  open,
  onClose,
  subjects,
  slot,
  initialDay,
  initialStart,
  onSave,
  onDelete,
  simple = false,
}: {
  open: boolean;
  onClose: () => void;
  subjects: DraftSubject[];
  slot?: DraftSlot;
  initialDay?: DraftSlot["dayOfWeek"];
  initialStart?: string;
  onSave: (
    subject: DraftSubject | undefined,
    slot: DraftSlot,
    editScope: DraftSlotEditScope,
  ) => void;
  onDelete?: () => void;
  simple?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<SlotFormInput, unknown, SlotFormValues>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: valuesFor(subjects, slot),
  });

  useEffect(() => {
    const values = valuesFor(subjects, slot);
    if (initialDay) values.dayOfWeek = initialDay;
    if (initialStart) {
      values.startTime = initialStart;
      const [hour, minute] = initialStart.split(":").map(Number);
      values.endTime = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    reset(values);
  }, [initialDay, initialStart, open, reset, slot, subjects]);

  const selectedSubjectId = useWatch({ control, name: "subjectTemporaryId" });
  const weekPattern = useWatch({ control, name: "weekPattern" });
  const startTime = useWatch({ control, name: "startTime" });
  const endTime = useWatch({ control, name: "endTime" });
  const duration = (() => {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    if (start === undefined || end === undefined || end <= start)
      return "CUSTOM";
    const minutes = end - start;
    return [30, 45, 50, 60, 75, 90, 120].includes(minutes)
      ? String(minutes)
      : "CUSTOM";
  })();

  const submit = handleSubmit((values) => {
    const existing = subjects.find(
      (item) => item.temporaryId === values.subjectTemporaryId,
    );
    const subject: DraftSubject | undefined = values.isBreak
      ? undefined
      : {
          temporaryId: existing?.temporaryId ?? crypto.randomUUID(),
          name: values.subjectName.trim(),
          code: values.subjectCode.trim() || undefined,
          shortName:
            values.shortName.trim() ||
            values.subjectName
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 5)
              .toUpperCase(),
          credits: values.credits,
          classType: values.classType,
          faculty: values.faculty
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          isZeroCredit: values.isZeroCredit,
          confidence: existing?.confidence ?? 1,
        };

    const savedSlot: DraftSlot = {
      temporaryId: slot?.temporaryId ?? crypto.randomUUID(),
      subjectTemporaryId: subject?.temporaryId,
      dayOfWeek: values.dayOfWeek,
      startTime: values.startTime,
      endTime: values.endTime,
      faculty: values.faculty
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      room: values.room.trim() || undefined,
      classType: values.classType,
      batchOptions: values.batchRestriction
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      electiveGroupId: values.electiveGroup.trim() || undefined,
      weekPattern: values.weekPattern,
      customWeekPattern: values.customWeekPattern.trim() || undefined,
      notes: values.notes.trim() || undefined,
      confidence: slot?.confidence ?? 1,
      isEnabled: values.isEnabled,
      isPlaceholder: values.isPlaceholder,
      isBreak: values.isBreak,
    };
    onSave(subject, savedSlot, values.editScope);
    onClose();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={slot ? "Edit class" : "Add a class"}
      description={
        simple
          ? "Update the class details below."
          : "Custom times, alternatives, batches, and alternating weeks are all supported."
      }
    >
      <form
        onSubmit={submit}
        className="grid gap-5"
        data-testid="slot-form"
        data-pwa-critical-operation="true"
      >
        {subjects.length > 0 ? (
          <Field label="Use a subject">
            <Select
              {...register("subjectTemporaryId")}
              onChange={(event) => {
                const id = event.target.value;
                setValue("subjectTemporaryId", id);
                const subject = subjects.find(
                  (item) => item.temporaryId === id,
                );
                if (subject) {
                  setValue("subjectName", subject.name);
                  setValue("subjectCode", subject.code ?? "");
                  setValue("shortName", subject.shortName);
                  setValue("credits", subject.credits);
                  setValue("classType", subject.classType);
                  setValue("isZeroCredit", subject.isZeroCredit);
                }
              }}
            >
              <option value="NEW">Create a new subject</option>
              {subjects.map((subject) => (
                <option key={subject.temporaryId} value={subject.temporaryId}>
                  {subject.name}
                  {subject.code ? ` · ${subject.code}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subject name" error={errors.subjectName?.message}>
            <Input
              {...register("subjectName")}
              placeholder="Digital Signal Processing"
            />
          </Field>
          <Field label="Subject code" error={errors.subjectCode?.message}>
            <Input {...register("subjectCode")} placeholder="BEC503" />
          </Field>
          {!simple ? (
            <>
              <Field label="Short name">
                <Input {...register("shortName")} placeholder="DSP" />
              </Field>
              <Field label="Class type">
                <Select {...register("classType")}>
                  {CLASS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type[0] + type.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Day">
            <Select {...register("dayOfWeek")}>
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>
                  {day[0] + day.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts">
            <Input type="time" {...register("startTime")} />
          </Field>
          <Field label="Ends" error={errors.endTime?.message}>
            <Input type="time" {...register("endTime")} />
          </Field>
          <Field label="Duration">
            <Select
              value={duration}
              onChange={(event) => {
                if (event.target.value === "CUSTOM") return;
                const start = timeToMinutes(startTime);
                if (start === undefined) return;
                const nextEnd = minutesToTime(
                  start + Number(event.target.value),
                );
                if (nextEnd)
                  setValue("endTime", nextEnd, { shouldValidate: true });
              }}
            >
              <option value="CUSTOM">Custom times</option>
              {[30, 45, 50, 60, 75, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {slot && !simple ? (
          <fieldset className="border-border grid gap-2 rounded-2xl border p-4">
            <legend className="px-2 font-bold">Apply changes to</legend>
            {[
              ["ONE_SESSION", "This recurring session only"],
              [
                "WEEKDAY_SUBJECT",
                "Every session for this subject on this weekday",
              ],
              ["ALL_SUBJECT", "Every recurring session for this subject"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="bg-secondary flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-semibold"
              >
                <input
                  type="radio"
                  value={value}
                  className="accent-primary size-4"
                  {...register("editScope")}
                />
                {label}
              </label>
            ))}
            <p className="text-muted-foreground text-xs leading-5">
              Multi-session edits shift matching times by the same amount and
              preserve each session’s weekday. Existing attendance remains
              attached to the earlier timetable version.
            </p>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Faculty" hint="Separate multiple names with commas">
            <Input {...register("faculty")} placeholder="PJ, AK" />
          </Field>
          <Field label="Room">
            <Input {...register("room")} placeholder="AB-304" />
          </Field>
          {!simple ? (
            <>
              <Field label="Credits">
                <Input
                  type="number"
                  min="0"
                  max="30"
                  step="0.5"
                  {...register("credits")}
                />
              </Field>
              <Field label="Week pattern">
                <Select {...register("weekPattern")}>
                  <option value="EVERY_WEEK">Every week</option>
                  <option value="ODD_WEEK">Odd weeks</option>
                  <option value="EVEN_WEEK">Even weeks</option>
                  <option value="CUSTOM">Custom rule</option>
                </Select>
              </Field>
              {weekPattern === "CUSTOM" ? (
                <Field label="Custom week rule" hint="Example: 1, 3, 5, 8-10">
                  <Input {...register("customWeekPattern")} />
                </Field>
              ) : null}
              <Field
                label="Batch restriction"
                hint="Leave blank if it applies to everyone"
              >
                <Input {...register("batchRestriction")} placeholder="B1, B2" />
              </Field>
              <Field
                label="Elective group"
                hint="Use the same name for alternatives"
              >
                <Input
                  {...register("electiveGroup")}
                  placeholder="Elective II"
                />
              </Field>
            </>
          ) : null}
        </div>

        {!simple ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="bg-secondary flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                {...register("isZeroCredit")}
              />
              Zero credit
            </label>
            <label className="bg-secondary flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                {...register("isPlaceholder")}
              />
              Placeholder
            </label>
            <label className="bg-secondary flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                {...register("isBreak")}
              />
              Break / lunch
            </label>
            <label className="bg-secondary flex items-center gap-2 rounded-xl p-3 text-sm font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                {...register("isEnabled")}
              />
              Include / applicable
            </label>
          </div>
        ) : null}

        {!simple ? (
          <Field label="Notes">
            <Textarea
              {...register("notes")}
              placeholder="Optional scheduling note"
            />
          </Field>
        ) : null}

        <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-4">
          {slot && onDelete ? (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              onClick={onDelete}
            >
              <Trash2 className="size-4" /> Remove class
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="save-slot">
            {slot
              ? "Save changes"
              : selectedSubjectId === "NEW"
                ? "Create class"
                : "Add class"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

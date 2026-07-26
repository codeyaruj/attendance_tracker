"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { addMonths, format } from "date-fns";
import { ArrowRight, UserRound } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { parseAcademicExceptionEntries } from "@/lib/academic-exception-input";
import { timeZoneSchema } from "@/lib/validation";
import { DAYS_OF_WEEK, type DayOfWeek } from "@/types";

const setupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Tell us what to call you").max(80),
    institution: z.string().trim().max(120),
    course: z.string().trim().max(120),
    section: z.string().trim().max(40),
    batch: z.string().trim().max(40),
    timezone: timeZoneSchema,
    weekStartsOn: z.enum(["MONDAY", "SUNDAY"]),
    semesterName: z
      .string()
      .trim()
      .min(1, "Semester name is required")
      .max(100),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    holidayEntries: z
      .string()
      .max(5000, "Keep holiday entries to 5,000 characters or fewer"),
    breakEntries: z
      .string()
      .max(5000, "Keep reading and exam entries to 5,000 characters or fewer"),
    teachingDays: z
      .array(z.enum(DAYS_OF_WEEK))
      .min(1, "Choose at least one teaching day"),
    minimumPercentage: z.coerce.number().min(0).max(100),
    safetyPercentage: z.coerce.number().min(0).max(100),
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "Semester must end after it starts",
  })
  .refine((value) => value.safetyPercentage >= value.minimumPercentage, {
    path: ["safetyPercentage"],
    message: "Safety target must be at least the minimum",
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) return;
    const shared = {
      semesterStartDate: value.startDate,
      semesterEndDate: value.endDate,
    };
    const fields = [
      {
        name: "holidayEntries" as const,
        type: "HOLIDAY" as const,
        value: value.holidayEntries,
      },
      {
        name: "breakEntries" as const,
        type: "BREAK" as const,
        value: value.breakEntries,
      },
    ];
    fields.forEach((field) => {
      const parsed = parseAcademicExceptionEntries(field.value, {
        ...shared,
        type: field.type,
      });
      if (parsed.errors.length > 0) {
        context.addIssue({
          code: "custom",
          path: [field.name],
          message: parsed.errors.join(" "),
        });
      }
    });
  });

export type ProfileSetupValues = z.infer<typeof setupSchema>;
type ProfileSetupInput = z.input<typeof setupSchema>;

export function ProfileSemesterForm({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (values: ProfileSetupValues) => void;
}) {
  const today = new Date();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<ProfileSetupInput, unknown, ProfileSetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      displayName: "",
      institution: "",
      course: "",
      section: "",
      batch: "",
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
      weekStartsOn: "MONDAY",
      semesterName: "Current semester",
      startDate: format(today, "yyyy-MM-dd"),
      endDate: format(addMonths(today, 5), "yyyy-MM-dd"),
      holidayEntries: "",
      breakEntries: "",
      teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      minimumPercentage: 60,
      safetyPercentage: 65,
    },
  });
  const teachingDays = useWatch({ control, name: "teachingDays" }) ?? [];

  const toggleTeachingDay = (day: DayOfWeek) => {
    const next = teachingDays.includes(day)
      ? teachingDays.filter((value) => value !== day)
      : DAYS_OF_WEEK.filter((value) => [...teachingDays, day].includes(value));
    setValue("teachingDays", next, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
            Set up your space
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
            A few details, then your timetable
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
            Only a display name is required. No account, roll number, email, or
            phone number.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
      <form
        onSubmit={handleSubmit(onContinue)}
        className="grid gap-5"
        data-testid="profile-setup-form"
      >
        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="bg-primary-soft text-primary grid size-10 place-items-center rounded-xl">
              <UserRound className="size-5" />
            </span>
            <div>
              <h2 className="font-extrabold">Your local profile</h2>
              <p className="text-muted-foreground text-sm">
                Multiple profiles can be added later.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" error={errors.displayName?.message}>
              <Input
                autoFocus
                autoComplete="name"
                {...register("displayName")}
                placeholder="Niyati"
              />
            </Field>
            <Field label="Institution (optional)">
              <Input {...register("institution")} placeholder="Your college" />
            </Field>
            <Field label="Course (optional)">
              <Input {...register("course")} placeholder="B.Tech ECE" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Section">
                <Input {...register("section")} placeholder="A" />
              </Field>
              <Field label="Batch">
                <Input {...register("batch")} placeholder="B1" />
              </Field>
            </div>
            <Field label="Timezone" error={errors.timezone?.message}>
              <Input {...register("timezone")} placeholder="Asia/Kolkata" />
            </Field>
            <Field label="Week starts on">
              <Select {...register("weekStartsOn")}>
                <option value="MONDAY">Monday</option>
                <option value="SUNDAY">Sunday</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="font-extrabold">Semester guardrails</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Percentages support decimals, such as 67.5%.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Semester name" error={errors.semesterName?.message}>
              <Input {...register("semesterName")} />
            </Field>
            <span className="hidden sm:block" />
            <Field label="Starts" error={errors.startDate?.message}>
              <Input type="date" {...register("startDate")} />
            </Field>
            <Field label="Ends" error={errors.endDate?.message}>
              <Input type="date" {...register("endDate")} />
            </Field>
            <Field
              label="Holiday dates (optional)"
              error={errors.holidayEntries?.message}
              hint="One per line: YYYY-MM-DD or a date range using ‘to’. Add an optional note after —."
            >
              <Textarea
                className="min-h-24 font-mono"
                {...register("holidayEntries")}
                placeholder={"2026-08-15 — Independence Day\n2026-10-02"}
              />
            </Field>
            <Field
              label="Reading and exam periods (optional)"
              error={errors.breakEntries?.message}
              hint="Ranges become non-teaching breaks and must stay inside the semester."
            >
              <Textarea
                className="min-h-24 font-mono"
                {...register("breakEntries")}
                placeholder={
                  "2026-09-21 to 2026-09-27 — Reading week\n2026-12-01 to 2026-12-10 — Exams"
                }
              />
            </Field>
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="text-sm font-bold">Teaching days</legend>
              <p className="text-muted-foreground text-xs">
                Timetable days found later are included automatically.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {DAYS_OF_WEEK.map((day) => (
                  <label
                    key={day}
                    className="bg-secondary flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold"
                  >
                    <input
                      type="checkbox"
                      checked={teachingDays.includes(day)}
                      onChange={() => toggleTeachingDay(day)}
                      className="accent-primary size-4"
                    />
                    {day[0] + day.slice(1, 3).toLowerCase()}
                  </label>
                ))}
              </div>
              {errors.teachingDays?.message ? (
                <p className="text-danger text-xs font-semibold">
                  {errors.teachingDays.message}
                </p>
              ) : null}
            </fieldset>
            <Field
              label="Minimum required (%)"
              error={errors.minimumPercentage?.message}
            >
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                {...register("minimumPercentage")}
              />
            </Field>
            <Field
              label="Personal safety target (%)"
              error={errors.safetyPercentage?.message}
              hint="Must be equal to or above the minimum"
            >
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                {...register("safetyPercentage")}
              />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            Continue to timetable <ArrowRight className="size-5" />
          </Button>
        </div>
      </form>
    </div>
  );
}

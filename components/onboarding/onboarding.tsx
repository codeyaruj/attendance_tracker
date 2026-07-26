"use client";

import {
  ArrowRight,
  CalendarCheck2,
  FileUp,
  Keyboard,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-controls";
import { attendSafeRepository } from "@/db";
import type { ManualTimetableInput } from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import { AttendanceUnavailableState } from "@/components/attendance/data-state";
import { parseSemesterExceptionEntries } from "@/lib/academic-exception-input";
import type { NormalizedTimetableDraft } from "@/types";
import { DAYS_OF_WEEK } from "@/types";
import { DraftEditor } from "../timetable/draft-editor";
import {
  ProfileSemesterForm,
  type ProfileSetupValues,
} from "./profile-semester-form";
import {
  TimetableConfirmation,
  type ConfirmationSelections,
} from "./timetable-confirmation";
import {
  createEmptyDraft,
  UploadTimetable,
  type ImageEdits,
} from "./upload-timetable";

type PathChoice = "UPLOAD" | "MANUAL";
type Stage = "CHOICE" | "PROFILE" | "UPLOAD" | "MANUAL" | "CONFIRM" | "DEMO";
type SourceReference = {
  file: File;
  edits: ImageEdits;
  extractionMessage?: string;
};

function toBasisPoints(percentage: number): number {
  return Math.round(percentage * 100);
}

export function resolvedOnboardingBatch(
  selections: Pick<ConfirmationSelections, "batchDecision" | "batch">,
  setupBatch?: string,
): string | undefined {
  if (selections.batchDecision === "NOT_ASKED")
    return setupBatch?.trim() || undefined;
  if (selections.batchDecision === "SELECTED")
    return selections.batch?.trim() || undefined;
  return undefined;
}

function timetableInput(
  draft: NormalizedTimetableDraft,
  setup: ProfileSetupValues,
  semesterId: string,
  selections: ConfirmationSelections,
  source: "UPLOAD" | "MANUAL",
  uploadedReferenceId?: string,
): ManualTimetableInput {
  const selectedSubjectIds = new Set(
    Object.values(selections.electiveSubjectIds).flat(),
  );
  return {
    semesterId,
    title: draft.title || setup.semesterName,
    timezone: draft.timezone || setup.timezone,
    label: "Initial confirmed timetable",
    effectiveStartDate: setup.startDate,
    isConfirmed: true,
    source,
    uploadedReferenceId,
    activate: true,
    subjects: draft.subjects.map((subject) => {
      const attendance = selections.initialAttendance[subject.temporaryId] ?? {
        held: 0,
        attended: 0,
      };
      const hasEnabledSlot = draft.timetableSlots.some(
        (slot) =>
          slot.subjectTemporaryId === subject.temporaryId && slot.isEnabled,
      );
      return {
        clientId: subject.temporaryId,
        code: subject.code,
        name: subject.name,
        shortName: subject.shortName,
        credits: subject.credits,
        classType: subject.classType,
        isZeroCredit: subject.isZeroCredit,
        isEnabled: hasEnabledSlot,
        initialHeld: attendance.held,
        initialAttended: attendance.attended,
        countsCancelledSessions: false,
        exemptPolicy: "EXCLUDED" as const,
      };
    }),
    electiveGroups: draft.detectedElectiveGroups.map((group) => ({
      clientId: group.id,
      name: group.name,
      options: group.options.map((option) => ({
        subjectId: option.subjectTemporaryId,
        label: option.label,
      })),
      selectedSubjectIds: (
        selections.electiveSubjectIds[group.id] ?? []
      ).filter((id) => selectedSubjectIds.has(id)),
      allowMultiple: group.allowMultiple ?? false,
    })),
    slots: draft.timetableSlots.map((slot) => ({
      subjectId: slot.subjectTemporaryId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      faculty: slot.faculty,
      room: slot.room,
      batchRestriction: slot.batchOptions,
      electiveGroupId: slot.electiveGroupId,
      weekPattern: slot.weekPattern,
      customWeekPattern: slot.customWeekPattern,
      notes: slot.notes,
      isEnabled: slot.isEnabled,
      isPlaceholder: slot.isPlaceholder,
      isBreak: slot.isBreak,
    })),
  };
}

export function Onboarding() {
  const router = useRouter();
  const { data, loading, availability, error, refresh } = useAttendSafeData();
  const [stage, setStage] = useState<Stage>("CHOICE");
  const [path, setPath] = useState<PathChoice>("MANUAL");
  const [setup, setSetup] = useState<ProfileSetupValues>();
  const [draft, setDraft] =
    useState<NormalizedTimetableDraft>(createEmptyDraft());
  const [source, setSource] = useState<SourceReference>();
  const [saving, setSaving] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    if (
      stage === "CHOICE" &&
      availability === "READY" &&
      data?.activeProfile &&
      data.activeSemester
    ) {
      router.replace("/today");
    }
  }, [availability, data?.activeProfile, data?.activeSemester, router, stage]);

  if (
    stage === "CHOICE" &&
    availability !== "CHECKING" &&
    availability !== "READY"
  ) {
    return (
      <main className="bg-background grid min-h-dvh place-items-center p-6">
        <AttendanceUnavailableState
          kind={availability}
          message={error?.message}
          onRetry={refresh}
        />
      </main>
    );
  }

  if (
    stage === "CHOICE" &&
    (loading || availability === "CHECKING" || Boolean(data?.activeSemester))
  ) {
    return (
      <div
        className="bg-background grid min-h-dvh place-items-center p-6"
        role="status"
      >
        <div className="text-center">
          <LoaderCircle
            className="text-primary mx-auto size-7 animate-spin"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold">
            Opening your local semester…
          </p>
        </div>
      </div>
    );
  }

  const choosePath = (choice: PathChoice) => {
    setPath(choice);
    setStage("PROFILE");
  };

  const save = async (
    finalDraft: NormalizedTimetableDraft,
    selections: ConfirmationSelections,
  ) => {
    if (!setup) return;
    setSaving(true);
    try {
      const selectedBatch = resolvedOnboardingBatch(selections, setup.batch);
      const timetableDays = new Set([
        ...finalDraft.days,
        ...finalDraft.timetableSlots.map((slot) => slot.dayOfWeek),
      ]);
      const teachingDays = DAYS_OF_WEEK.filter(
        (day) => setup.teachingDays.includes(day) || timetableDays.has(day),
      );
      const parsedExceptions = parseSemesterExceptionEntries({
        holidayEntries: setup.holidayEntries,
        breakEntries: setup.breakEntries,
        semesterStartDate: setup.startDate,
        semesterEndDate: setup.endDate,
      });
      if (parsedExceptions.errors.length > 0) {
        throw new Error(parsedExceptions.errors.join(" "));
      }
      const profileSetup = await attendSafeRepository.createProfileSetup({
        profile: {
          displayName: setup.displayName,
          institution: setup.institution || undefined,
          course: setup.course || undefined,
          section: setup.section || undefined,
          batch: selectedBatch,
          timezone: setup.timezone,
          weekStartsOn: setup.weekStartsOn,
        },
        semester: {
          name: setup.semesterName,
          startDate: setup.startDate,
          endDate: setup.endDate,
          minimumAttendanceBasisPoints: toBasisPoints(setup.minimumPercentage),
          safetyTargetBasisPoints: toBasisPoints(setup.safetyPercentage),
          teachingDays,
        },
        academicExceptions: parsedExceptions.entries,
        activate: true,
      });

      let uploadedReferenceId: string | undefined;
      if (source) {
        // WebKit can reject File/Blob values during IndexedDB cloning. A typed
        // byte array is portable across Chromium, Firefox, and Safari/WebKit.
        const sourceBytes = new Uint8Array(await source.file.arrayBuffer());
        uploadedReferenceId = await attendSafeRepository.storeUploadReference({
          profileId: profileSetup.profile.id,
          semesterId: profileSetup.semester.id,
          filename: source.file.name,
          mediaType: source.file.type,
          blob: sourceBytes,
          rotation: source.edits.rotation,
          zoom: source.edits.zoom,
          crop: source.edits.crop,
        });
      }

      await attendSafeRepository.saveManualTimetable(
        timetableInput(
          finalDraft,
          setup,
          profileSetup.semester.id,
          selections,
          path,
          uploadedReferenceId,
        ),
      );
      await attendSafeRepository.updateSettings({
        selectedBatch,
        trackedClassTypes: {
          THEORY: selections.tracked.THEORY,
          LAB: selections.tracked.LAB,
          TUTORIAL: selections.tracked.TUTORIAL,
          SEMINAR: selections.tracked.SEMINAR,
          PROJECT: selections.tracked.PROJECT,
          OTHER: selections.tracked.OTHER,
        },
        includeZeroCredit: selections.tracked.ZERO_CREDIT,
      });
      toast.success("Your timetable is active and saved on this device");
      router.push("/today");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Your timetable could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const installDemo = async () => {
    setStage("DEMO");
    setDemoLoading(true);
    try {
      await attendSafeRepository.installDemo("Demo student");
      toast.success("Demo timetable loaded");
      router.push("/dashboard");
    } catch (error) {
      setStage("CHOICE");
      toast.error(
        error instanceof Error
          ? error.message
          : "The demo could not be loaded.",
      );
    } finally {
      setDemoLoading(false);
    }
  };

  if (stage === "PROFILE") {
    return (
      <OnboardingCanvas>
        <ProfileSemesterForm
          onBack={() => setStage("CHOICE")}
          onContinue={(values) => {
            setSetup(values);
            setDraft({
              ...createEmptyDraft(values.timezone),
              title: values.semesterName,
            });
            setStage(path);
          }}
        />
      </OnboardingCanvas>
    );
  }

  if (stage === "UPLOAD" && setup) {
    return (
      <OnboardingCanvas>
        <UploadTimetable
          timezone={setup.timezone}
          onBack={() => setStage("PROFILE")}
          onReady={(nextDraft, nextSource) => {
            setDraft({
              ...nextDraft,
              title: nextDraft.title || setup.semesterName,
            });
            setSource({
              file: nextSource.file,
              edits: nextSource.edits,
              extractionMessage: nextSource.extractionMessage,
            });
            setStage("CONFIRM");
          }}
        />
      </OnboardingCanvas>
    );
  }

  if (stage === "MANUAL" && setup) {
    return (
      <OnboardingCanvas>
        <div className="mx-auto grid w-full max-w-7xl gap-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
                Manual timetable
              </p>
              <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Build it your way
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                Use the visual grid, detailed form list, or paste schedule text.
                Custom times and overlapping alternatives are supported.
              </p>
            </div>
            <Button variant="ghost" onClick={() => setStage("PROFILE")}>
              Back
            </Button>
          </div>
          <Card className="p-4 sm:p-5">
            <div className="mb-4 max-w-md">
              <Field label="Timetable title">
                <Input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <DraftEditor value={draft} onChange={setDraft} />
          </Card>
          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={draft.timetableSlots.length === 0}
              onClick={() => setStage("CONFIRM")}
              data-testid="review-manual-timetable"
            >
              Review timetable <ArrowRight className="size-5" />
            </Button>
          </div>
        </div>
      </OnboardingCanvas>
    );
  }

  if (stage === "CONFIRM" && setup) {
    return (
      <OnboardingCanvas>
        <TimetableConfirmation
          value={draft}
          source={source}
          onChange={setDraft}
          onBack={() => setStage(path)}
          onConfirm={save}
          saving={saving}
        />
      </OnboardingCanvas>
    );
  }

  return (
    <main className="min-h-dvh overflow-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <Brand />
          <span className="text-muted-foreground hidden items-center gap-2 text-xs font-semibold sm:flex">
            <LockKeyhole className="text-primary size-4" /> Private,
            local-first, no login
          </span>
        </header>

        <section className="grid flex-1 content-center gap-8 py-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:gap-14 lg:py-14">
          <div>
            <span className="bg-primary-soft text-primary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold">
              <ShieldCheck className="size-4" /> Your attendance, without the
              guesswork
            </span>
            <h1 className="font-display mt-5 max-w-xl text-[clamp(2.8rem,7vw,5.9rem)] leading-[0.92] font-black tracking-[-0.065em]">
              Know what you can{" "}
              <span className="text-primary">safely skip.</span>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-lg text-base leading-7 sm:text-lg">
              Add your timetable, mark attendance, and see exactly which
              upcoming classes keep every subject above your target.
            </p>
            <div className="mt-7 grid max-w-lg grid-cols-3 gap-2 text-center">
              <div className="bg-surface rounded-2xl p-3">
                <p className="text-primary text-lg font-black">100%</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  on-device data
                </p>
              </div>
              <div className="bg-surface rounded-2xl p-3">
                <p className="text-primary text-lg font-black">Exact</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  skip math
                </p>
              </div>
              <div className="bg-surface rounded-2xl p-3">
                <p className="text-primary text-lg font-black">Offline</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  daily tracking
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <p className="text-foreground text-sm font-bold">
              How would you like to begin?
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => choosePath("UPLOAD")}
                className="group border-border bg-surface hover:border-primary/50 focus-visible:ring-primary flex min-h-[260px] flex-col rounded-3xl border p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none"
                data-testid="choose-upload"
              >
                <span className="bg-primary-soft text-primary grid size-12 place-items-center rounded-2xl">
                  <FileUp className="size-6" />
                </span>
                <h2 className="mt-7 text-xl font-extrabold">
                  Upload timetable
                </h2>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  Photo, screenshot, WebP, or PDF. Crop and review every
                  extracted field.
                </p>
                <span className="text-primary mt-auto flex items-center gap-2 pt-6 text-sm font-bold">
                  Choose a file{" "}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => choosePath("MANUAL")}
                className="group border-border bg-surface hover:border-primary/50 focus-visible:ring-primary flex min-h-[260px] flex-col rounded-3xl border p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none"
                data-testid="choose-manual"
              >
                <span className="bg-info-soft text-info-strong grid size-12 place-items-center rounded-2xl">
                  <Keyboard className="size-6" />
                </span>
                <h2 className="mt-7 text-xl font-extrabold">Enter manually</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  Use a weekly grid, detailed forms, or paste timetable text.
                  Full control from the start.
                </p>
                <span className="text-primary mt-auto flex items-center gap-2 pt-6 text-sm font-bold">
                  Open builder{" "}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={installDemo}
              disabled={demoLoading}
              className="border-border bg-background hover:bg-surface focus-visible:ring-primary flex min-h-20 items-center gap-4 rounded-2xl border p-4 text-left transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
              data-testid="load-demo"
            >
              <span className="bg-warning-soft text-warning-strong grid size-11 shrink-0 place-items-center rounded-xl">
                {demoLoading ? (
                  <LoaderCircle className="size-5 animate-spin" />
                ) : (
                  <Sparkles className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">
                  Explore with a demo timetable
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  Includes electives, batch labs, zero-credit classes, and
                  attendance history.
                </span>
              </span>
              <ArrowRight className="text-muted-foreground size-5 shrink-0" />
            </button>
          </div>
        </section>

        <footer className="border-border text-muted-foreground flex flex-col gap-3 border-t py-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <CalendarCheck2 className="text-primary size-4" /> Built for
            personal attendance, not faculty administration.
          </p>
          <p className="flex items-center gap-2">
            <LibraryBig className="text-primary size-4" /> Multiple local
            profiles supported.
          </p>
        </footer>
      </div>
    </main>
  );
}

function OnboardingCanvas({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto mb-8 flex max-w-7xl items-center justify-between">
        <Brand />
        <span className="text-muted-foreground hidden items-center gap-2 text-xs font-semibold sm:flex">
          <LockKeyhole className="text-primary size-4" /> Saved on this device
        </span>
      </div>
      {children}
    </main>
  );
}

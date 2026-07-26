"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/form-controls";
import { attendSafeRepository, type AttendSafeSnapshot } from "@/db";
import type { AppSettings, ClassType, Subject } from "@/types/domain";

import {
  basisPointsToPercentage,
  settingsWithTrackedType,
  subjectOverrideChanges,
  validateAttendanceCounts,
  validateSubjectThresholds,
} from "./settings-model";
import { SettingsSection } from "./settings-section";

const classTypeLabels: Record<ClassType, string> = {
  THEORY: "Theory",
  LAB: "Labs",
  TUTORIAL: "Tutorials",
  SEMINAR: "Seminars",
  PROJECT: "Projects",
  OTHER: "Other",
};

function SubjectPolicyRow({
  subject,
  semesterMinimum,
  semesterSafety,
}: {
  subject: Subject;
  semesterMinimum: number;
  semesterSafety: number;
}) {
  const [minimum, setMinimum] = useState(
    subject.minimumAttendanceBasisPointsOverride === undefined
      ? ""
      : basisPointsToPercentage(subject.minimumAttendanceBasisPointsOverride),
  );
  const [safety, setSafety] = useState(
    subject.safetyTargetBasisPointsOverride === undefined
      ? ""
      : basisPointsToPercentage(subject.safetyTargetBasisPointsOverride),
  );
  const [enabled, setEnabled] = useState(subject.isEnabled);
  const [zeroCredit, setZeroCredit] = useState(subject.isZeroCredit);
  const [countsCancelled, setCountsCancelled] = useState(
    subject.countsCancelledSessions,
  );
  const [exemptPolicy, setExemptPolicy] = useState(subject.exemptPolicy);
  const [initialHeld, setInitialHeld] = useState(String(subject.initialHeld));
  const [initialAttended, setInitialAttended] = useState(
    String(subject.initialAttended),
  );
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateSubjectThresholds(
      minimum,
      safety,
      semesterMinimum,
      semesterSafety,
    );
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    const counts = validateAttendanceCounts(initialHeld, initialAttended);
    if (!counts.valid) {
      toast.error(counts.message);
      return;
    }
    setBusy(true);
    try {
      await attendSafeRepository.updateSubject(subject.id, {
        ...subjectOverrideChanges(minimum, safety),
        isEnabled: enabled,
        isZeroCredit: zeroCredit,
        countsCancelledSessions: countsCancelled,
        exemptPolicy,
        initialHeld: counts.held,
        initialAttended: counts.attended,
      });
      toast.success(`${subject.shortName} policy saved`);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Subject policy could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group border-border bg-surface rounded-2xl border">
      <summary className="focus-visible:ring-primary flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none">
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">
            {subject.name}
          </span>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {subject.code ? <span>{subject.code}</span> : null}
            <Badge tone={subject.isEnabled ? "safe" : "neutral"}>
              {subject.isEnabled ? "Tracked" : "Paused"}
            </Badge>
            {subject.isZeroCredit ? (
              <Badge tone="info">Zero credit</Badge>
            ) : null}
          </span>
        </span>
        <span className="text-muted-foreground text-xl transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <form
        className="border-border grid gap-4 border-t p-4"
        onSubmit={(event) => void save(event)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label="Track this subject"
            description="Include it in Today, Dashboard, and skip planning."
          />
          <Switch
            checked={zeroCredit}
            onChange={setZeroCredit}
            label="Zero-credit subject"
            description="Label separately while retaining its own attendance rule."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum override (%)"
            hint={`Blank uses semester default (${semesterMinimum / 100}%).`}
          >
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              placeholder={String(semesterMinimum / 100)}
            />
          </Field>
          <Field
            label="Safety override (%)"
            hint={`Blank uses semester default (${semesterSafety / 100}%).`}
          >
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={safety}
              onChange={(event) => setSafety(event.target.value)}
              placeholder={String(semesterSafety / 100)}
            />
          </Field>
          <Field
            label="Exempt sessions"
            hint="Choose whether an exemption is excluded or credited as attended."
          >
            <Select
              value={exemptPolicy}
              onChange={(event) =>
                setExemptPolicy(event.target.value as Subject["exemptPolicy"])
              }
            >
              <option value="EXCLUDED">Exclude from held classes</option>
              <option value="ATTENDED">Count as attended</option>
            </Select>
          </Field>
          <Switch
            checked={countsCancelled}
            onChange={setCountsCancelled}
            label="Count cancelled sessions"
            description="Off by default. Enable only if your institution includes them."
          />
        </div>
        <fieldset className="border-border rounded-xl border p-3">
          <legend className="px-1 text-sm font-bold">
            Attendance before AttendSafe
          </legend>
          <p className="text-muted-foreground mb-3 text-xs">
            Keep these totals in sync if you started tracking mid-semester.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Classes held">
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={initialHeld}
                onChange={(event) => setInitialHeld(event.target.value)}
              />
            </Field>
            <Field label="Classes attended">
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={initialAttended}
                onChange={(event) => setInitialAttended(event.target.value)}
              />
            </Field>
          </div>
        </fieldset>
        <div className="text-right">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save subject policy"}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function AttendancePolicySettings({
  data,
}: {
  data: AttendSafeSnapshot;
}) {
  const [settings, setSettings] = useState(data.settings);

  const setTracked = async (classType: ClassType, checked: boolean) => {
    const trackedClassTypes = settingsWithTrackedType(
      settings,
      classType,
      checked,
    );
    const next: AppSettings = { ...settings, trackedClassTypes };
    setSettings(next);
    try {
      await attendSafeRepository.updateSettings({ trackedClassTypes });
    } catch (cause) {
      setSettings(data.settings);
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Tracking preference could not be saved.",
      );
    }
  };

  const setZeroCreditTracking = async (includeZeroCredit: boolean) => {
    const next: AppSettings = { ...settings, includeZeroCredit };
    setSettings(next);
    try {
      await attendSafeRepository.updateSettings({ includeZeroCredit });
    } catch (cause) {
      setSettings(data.settings);
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Zero-credit tracking preference could not be saved.",
      );
    }
  };

  if (!data.activeSemester) return null;

  return (
    <SettingsSection
      id="attendance-policy"
      icon={SlidersHorizontal}
      title="Attendance policy"
      description="Choose class types to resolve from the timetable, then fine-tune thresholds and counting rules per subject."
    >
      <fieldset>
        <legend className="text-sm font-bold">Tracked class types</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(classTypeLabels) as ClassType[]).map((classType) => (
            <Switch
              key={classType}
              checked={settings.trackedClassTypes[classType]}
              onChange={(checked) => void setTracked(classType, checked)}
              label={classTypeLabels[classType]}
              description={
                classType === "THEORY"
                  ? "Recommended for every timetable."
                  : "Enable only when you want these classes counted."
              }
            />
          ))}
          <Switch
            checked={settings.includeZeroCredit ?? false}
            onChange={(checked) => void setZeroCreditTracking(checked)}
            label="Zero-credit subjects"
            description="Keep their schedule stored and choose whether they count now."
          />
        </div>
      </fieldset>

      <div className="border-border mt-7 border-t pt-6">
        <h3 className="font-bold">Subject overrides</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Empty override fields inherit the semester guardrails.
        </p>
        <div className="mt-4 grid gap-3">
          {data.subjects.map((subject) => (
            <SubjectPolicyRow
              key={subject.id}
              subject={subject}
              semesterMinimum={
                data.activeSemester!.minimumAttendanceBasisPoints
              }
              semesterSafety={data.activeSemester!.safetyTargetBasisPoints}
            />
          ))}
          {data.subjects.length === 0 ? (
            <p className="bg-secondary text-muted-foreground rounded-2xl p-4 text-sm">
              Add or confirm a timetable to configure subjects.
            </p>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}

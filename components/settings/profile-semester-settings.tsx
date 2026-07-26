"use client";

import { addMonths, format } from "date-fns";
import { Plus, Save, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import {
  attendSafeRepository,
  createEntityId,
  createRepositories,
  db,
  entityTimestamps,
  type AttendSafeSnapshot,
} from "@/db";
import { DAYS_OF_WEEK, type DayOfWeek } from "@/types/domain";
import { timeZoneSchema } from "@/lib/validation";

import {
  basisPointsToPercentage,
  validateThresholdPair,
} from "./settings-model";
import { SettingsSection } from "./settings-section";

const weekdayLabels: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

export function ProfileSemesterSettings({
  data,
}: {
  data: AttendSafeSnapshot;
}) {
  const profile = data.activeProfile;
  const semester = data.activeSemester;
  const today = format(new Date(), "yyyy-MM-dd");
  const defaultEnd = format(addMonths(new Date(), 5), "yyyy-MM-dd");
  const [profileBusy, setProfileBusy] = useState(false);
  const [semesterBusy, setSemesterBusy] = useState(false);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [showNewSemester, setShowNewSemester] = useState(false);

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [institution, setInstitution] = useState(profile?.institution ?? "");
  const [course, setCourse] = useState(profile?.course ?? "");
  const [section, setSection] = useState(profile?.section ?? "");
  const [batch, setBatch] = useState(profile?.batch ?? "");
  const [timezone, setTimezone] = useState(
    profile?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "Asia/Kolkata",
  );
  const [weekStartsOn, setWeekStartsOn] = useState<"MONDAY" | "SUNDAY">(
    profile?.weekStartsOn ?? "MONDAY",
  );

  const [semesterName, setSemesterName] = useState(semester?.name ?? "");
  const [startDate, setStartDate] = useState(semester?.startDate ?? today);
  const [endDate, setEndDate] = useState(semester?.endDate ?? defaultEnd);
  const [minimum, setMinimum] = useState(
    semester
      ? basisPointsToPercentage(semester.minimumAttendanceBasisPoints)
      : "60",
  );
  const [safety, setSafety] = useState(
    semester ? basisPointsToPercentage(semester.safetyTargetBasisPoints) : "65",
  );
  const [teachingDays, setTeachingDays] = useState<DayOfWeek[]>(
    semester?.teachingDays ?? [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
    ],
  );

  const [newDisplayName, setNewDisplayName] = useState("");
  const [newSemesterName, setNewSemesterName] = useState("Current semester");
  const [newStartDate, setNewStartDate] = useState(today);
  const [newEndDate, setNewEndDate] = useState(defaultEnd);

  const selectProfile = async (profileId: string) => {
    const selected = data.profiles.find((item) => item.id === profileId);
    if (!selected) return;
    const semesters =
      await createRepositories(db).semesters.listByProfile(profileId);
    await attendSafeRepository.updateSettings({
      activeProfileId: profileId,
      activeSemesterId: semesters.at(-1)?.id,
      selectedBatch: selected.batch,
    });
    toast.success(`Switched to ${selected.displayName}`);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    if (!displayName.trim()) {
      toast.error("Display name is required.");
      return;
    }
    const parsedTimezone = timeZoneSchema.safeParse(timezone);
    if (!parsedTimezone.success) {
      toast.error("Enter a valid IANA timezone, such as Asia/Kolkata.");
      return;
    }
    setProfileBusy(true);
    try {
      await createRepositories(db).profiles.update(profile.id, {
        displayName: displayName.trim(),
        institution: optional(institution),
        course: optional(course),
        section: optional(section),
        batch: optional(batch),
        timezone: parsedTimezone.data,
        weekStartsOn,
      });
      if (data.settings.activeProfileId === profile.id) {
        await attendSafeRepository.updateSettings({
          selectedBatch: optional(batch),
        });
      }
      toast.success("Profile saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Profile could not be saved.",
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const saveSemester = async (event: FormEvent) => {
    event.preventDefault();
    if (!semester) return;
    const thresholds = validateThresholdPair(Number(minimum), Number(safety));
    if (!thresholds.valid) {
      toast.error(thresholds.message);
      return;
    }
    if (!semesterName.trim() || endDate < startDate) {
      toast.error("Enter a semester name and a valid date range.");
      return;
    }
    if (teachingDays.length === 0) {
      toast.error("Choose at least one teaching day.");
      return;
    }
    setSemesterBusy(true);
    try {
      await attendSafeRepository.updateSemester(semester.id, {
        name: semesterName.trim(),
        startDate,
        endDate,
        minimumAttendanceBasisPoints: thresholds.minimumBasisPoints,
        safetyTargetBasisPoints: thresholds.safetyBasisPoints,
        teachingDays,
      });
      toast.success("Semester guardrails saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Semester could not be saved.",
      );
    } finally {
      setSemesterBusy(false);
    }
  };

  const createProfile = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await attendSafeRepository.createProfileSetup({
        profile: {
          displayName: newDisplayName,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
        },
        semester: {
          name: newSemesterName,
          startDate: newStartDate,
          endDate: newEndDate,
        },
      });
      setShowNewProfile(false);
      toast.success("Local profile created");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Profile could not be created.",
      );
    }
  };

  const createSemester = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    if (!newSemesterName.trim() || newEndDate < newStartDate) {
      toast.error("Enter a semester name and valid date range.");
      return;
    }
    const now = new Date().toISOString();
    const id = createEntityId();
    try {
      await db.transaction("rw", [db.semesters, db.appSettings], async () => {
        await db.semesters.add({
          id,
          profileId: profile.id,
          name: newSemesterName.trim(),
          startDate: newStartDate,
          endDate: newEndDate,
          minimumAttendanceBasisPoints: 6000,
          safetyTargetBasisPoints: 6500,
          teachingDays: [
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
          ],
          ...entityTimestamps(now),
        });
        await db.appSettings.put({
          ...data.settings,
          activeProfileId: profile.id,
          activeSemesterId: id,
          updatedAt: now,
        });
      });
      setShowNewSemester(false);
      toast.success("Semester created");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Semester could not be created.",
      );
    }
  };

  return (
    <SettingsSection
      id="profile-semester"
      icon={UserRound}
      title="Profiles and semester"
      description="Keep separate local profiles, choose the active semester, and set subject-wide attendance guardrails."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewProfile((shown) => !shown)}
        >
          <Plus className="size-4" aria-hidden="true" /> New profile
        </Button>
      }
    >
      {showNewProfile ? (
        <form
          className="bg-secondary mb-6 grid gap-3 rounded-2xl p-4 sm:grid-cols-2"
          onSubmit={(event) => void createProfile(event)}
        >
          <Field label="Display name">
            <Input
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
              required
            />
          </Field>
          <Field label="First semester">
            <Input
              value={newSemesterName}
              onChange={(event) => setNewSemesterName(event.target.value)}
              required
            />
          </Field>
          <Field label="Starts">
            <Input
              type="date"
              value={newStartDate}
              onChange={(event) => setNewStartDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Ends">
            <Input
              type="date"
              value={newEndDate}
              onChange={(event) => setNewEndDate(event.target.value)}
              required
            />
          </Field>
          <div className="sm:col-span-2 sm:text-right">
            <Button type="submit">Create and switch</Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Active profile">
          <Select
            value={profile?.id ?? ""}
            onChange={(event) => void selectProfile(event.target.value)}
          >
            <option value="" disabled>
              Choose a profile
            </option>
            {data.profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Active semester">
          <div className="flex gap-2">
            <Select
              value={semester?.id ?? ""}
              disabled={!profile}
              onChange={(event) =>
                void attendSafeRepository.updateSettings({
                  activeSemesterId: event.target.value,
                })
              }
            >
              <option value="" disabled>
                Choose a semester
              </option>
              {data.semesters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Create semester"
              disabled={!profile}
              onClick={() => setShowNewSemester((shown) => !shown)}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </Field>
      </div>

      {showNewSemester ? (
        <form
          className="bg-secondary mt-4 grid gap-3 rounded-2xl p-4 sm:grid-cols-2"
          onSubmit={(event) => void createSemester(event)}
        >
          <Field label="Semester name">
            <Input
              value={newSemesterName}
              onChange={(event) => setNewSemesterName(event.target.value)}
              required
            />
          </Field>
          <span className="hidden sm:block" />
          <Field label="Starts">
            <Input
              type="date"
              value={newStartDate}
              onChange={(event) => setNewStartDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Ends">
            <Input
              type="date"
              value={newEndDate}
              onChange={(event) => setNewEndDate(event.target.value)}
              required
            />
          </Field>
          <div className="sm:col-span-2 sm:text-right">
            <Button type="submit">Create semester</Button>
          </div>
        </form>
      ) : null}

      {profile ? (
        <form
          key={profile.id}
          className="border-border mt-6 border-t pt-6"
          onSubmit={(event) => void saveProfile(event)}
        >
          <h3 className="font-bold">Profile details</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </Field>
            <Field label="Institution (optional)">
              <Input
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
              />
            </Field>
            <Field label="Course (optional)">
              <Input
                value={course}
                onChange={(event) => setCourse(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Section">
                <Input
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                />
              </Field>
              <Field label="Batch">
                <Input
                  value={batch}
                  onChange={(event) => setBatch(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Timezone">
              <Input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                required
              />
            </Field>
            <Field label="Week starts on">
              <Select
                value={weekStartsOn}
                onChange={(event) =>
                  setWeekStartsOn(event.target.value as "MONDAY" | "SUNDAY")
                }
              >
                <option value="MONDAY">Monday</option>
                <option value="SUNDAY">Sunday</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 text-right">
            <Button type="submit" disabled={profileBusy}>
              <Save className="size-4" aria-hidden="true" />
              {profileBusy ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      ) : null}

      {semester ? (
        <form
          key={semester.id}
          className="border-border mt-6 border-t pt-6"
          onSubmit={(event) => void saveSemester(event)}
        >
          <h3 className="font-bold">Semester guardrails</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Semester name">
              <Input
                value={semesterName}
                onChange={(event) => setSemesterName(event.target.value)}
                required
              />
            </Field>
            <span className="hidden sm:block" />
            <Field label="Starts">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Ends">
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Minimum required (%)">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                required
              />
            </Field>
            <Field
              label="Safety target (%)"
              hint="Must be equal to or above the minimum"
            >
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={safety}
                onChange={(event) => setSafety(event.target.value)}
                required
              />
            </Field>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Teaching days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => (
                <label
                  key={day}
                  className="border-border has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold"
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={teachingDays.includes(day)}
                    onChange={(event) =>
                      setTeachingDays((current) =>
                        event.target.checked
                          ? [...current, day]
                          : current.filter((item) => item !== day),
                      )
                    }
                  />
                  {weekdayLabels[day]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 text-right">
            <Button type="submit" disabled={semesterBusy}>
              <Save className="size-4" aria-hidden="true" />
              {semesterBusy ? "Saving…" : "Save semester"}
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}

"use client";

import {
  CalendarClock,
  DatabaseBackup,
  HardDrive,
  Palette,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

import {
  AttendanceLoadingState,
  AttendanceUnavailableState,
} from "@/components/attendance/data-state";
import { Card } from "@/components/ui/card";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";

import { AttendancePolicySettings } from "./attendance-policy-settings";
import {
  DataPrivacySettings,
  PreferenceSettings,
} from "./data-privacy-settings";
import { ProfileSemesterSettings } from "./profile-semester-settings";
import { ScheduleSettings } from "./schedule-settings";
import { InstallApplicationSettings } from "./install-application-settings";

const sections = [
  { href: "#profile-semester", label: "Profile", icon: UserRound },
  { href: "#attendance-policy", label: "Policy", icon: SlidersHorizontal },
  { href: "#schedule-rules", label: "Schedule", icon: CalendarClock },
  { href: "#preferences", label: "Appearance", icon: Palette },
  { href: "#install-application", label: "Install", icon: HardDrive },
  { href: "#backup-privacy", label: "Backup", icon: DatabaseBackup },
] as const;

export function SettingsScreen() {
  const { data, loading, availability, error, refresh } = useAttendSafeData();

  if (loading || availability === "CHECKING") {
    return <AttendanceLoadingState label="Loading local settings" />;
  }
  if (availability !== "READY" || !data) {
    return (
      <AttendanceUnavailableState
        kind={availability === "READY" ? "ERROR" : availability}
        message={error?.message}
        onRetry={refresh}
      />
    );
  }

  const settingsKey = `${data.activeProfile?.id ?? "none"}-${data.activeSemester?.id ?? "none"}`;

  return (
    <div className="grid gap-5" data-testid="settings-page">
      <Card className="bg-primary text-primary-foreground overflow-hidden">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-primary-foreground/85 text-xs font-bold tracking-[0.16em] uppercase">
              Local-first control center
            </p>
            <h2 className="font-display mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              Your rules, your timetable, your device
            </h2>
            <p className="text-primary-foreground/80 mt-2 max-w-2xl text-sm leading-6">
              Edit attendance guardrails, resolve schedule choices, and keep a
              portable backup. AttendSafe does not require an account or upload
              attendance data.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4">
            <HardDrive className="size-6" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold">Stored locally</p>
              <p className="text-primary-foreground text-xs">
                {data.profiles.length} local{" "}
                {data.profiles.length === 1 ? "profile" : "profiles"}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <nav
        aria-label="Settings sections"
        className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {sections.map((section) => (
          <a
            key={section.href}
            href={section.href}
            className="border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:ring-primary inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <section.icon className="size-4" aria-hidden="true" />
            {section.label}
          </a>
        ))}
      </nav>

      <ProfileSemesterSettings key={`profile-${settingsKey}`} data={data} />
      <AttendancePolicySettings key={`policy-${settingsKey}`} data={data} />
      <ScheduleSettings key={`schedule-${settingsKey}`} data={data} />
      <PreferenceSettings
        key={`preferences-${data.settings.updatedAt}`}
        data={data}
      />
      <InstallApplicationSettings />
      <DataPrivacySettings key={`data-${settingsKey}`} data={data} />
    </div>
  );
}

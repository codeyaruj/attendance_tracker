import type { Metadata } from "next";

import { SettingsScreen } from "@/components/settings/settings-screen";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Manage AttendSafe profiles, attendance policy, timetable versions, and local backups.",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}

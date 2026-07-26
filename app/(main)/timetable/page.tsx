import type { Metadata } from "next";

import { TimetableScreen } from "@/components/timetable/timetable-screen";

export const metadata: Metadata = { title: "Timetable" };

export default function TimetablePage() {
  return <TimetableScreen />;
}

import type { Metadata } from "next";

import { TodayScreen } from "@/components/attendance/today-screen";

export const metadata: Metadata = {
  title: "Today",
};

export default function TodayPage() {
  return <TodayScreen />;
}

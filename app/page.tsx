import type { Metadata } from "next";
import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata: Metadata = {
  title: { absolute: "AttendSafe — Know what you can safely skip" },
};

export default function HomePage() {
  return <Onboarding />;
}

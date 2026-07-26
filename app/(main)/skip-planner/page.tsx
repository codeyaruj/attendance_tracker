import type { Metadata } from "next";

import { PlannerScreen } from "@/components/planner";

export const metadata: Metadata = {
  title: "Skip Planner",
};

export default function SkipPlannerPage() {
  return <PlannerScreen />;
}

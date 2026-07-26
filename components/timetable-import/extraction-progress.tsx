"use client";

import { LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ExtractionProgress as ProgressState } from "@/lib/timetable-extraction";

const STAGE_LABELS: Record<ProgressState["stage"], string> = {
  VALIDATING_FILE: "Validating file",
  LOADING_PDF: "Loading PDF locally",
  RENDERING_PAGE: "Rendering PDF page",
  PREPARING_IMAGE: "Preparing image",
  FINDING_TIMETABLE: "Finding timetable regions",
  CORRECTING_PERSPECTIVE: "Checking page perspective",
  DETECTING_GRID: "Reconstructing the table grid",
  STARTING_OCR: "Starting local OCR",
  READING_CELLS: "Reading table cells",
  MATCHING_SUBJECTS: "Matching subjects and legend",
  READING_PAGE: "Reading timetable",
  RECONSTRUCTING_TIMETABLE: "Reconstructing timetable",
  PREPARING_PREVIEW: "Preparing editable preview",
};

export function ExtractionProgress({
  value,
  onCancel,
}: {
  value: ProgressState;
  onCancel: () => void;
}) {
  const page =
    value.pageIndex !== undefined && value.pageCount
      ? ` · page ${value.pageIndex + 1} of ${value.pageCount}`
      : "";
  return (
    <Card className="mx-auto w-full max-w-2xl p-6 sm:p-8" role="status">
      <div className="flex items-start gap-4">
        <span className="bg-primary-soft text-primary grid size-12 shrink-0 place-items-center rounded-2xl">
          <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-wider uppercase">
            Local processing
          </p>
          <h2 className="mt-1 text-xl font-extrabold">
            {STAGE_LABELS[value.stage]}
            {page}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {value.detail ?? "Your timetable stays inside this browser."}
          </p>
        </div>
      </div>
      <Progress
        value={Math.round(value.progress * 100)}
        className="mt-6"
        label="Timetable extraction progress"
      />
      <div className="mt-6 flex justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          data-testid="cancel-extraction"
        >
          <X className="size-4" /> Cancel
        </Button>
      </div>
    </Card>
  );
}

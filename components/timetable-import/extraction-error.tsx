"use client";

import { AlertTriangle, Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function ExtractionError({
  message,
  onRetry,
  onManual,
}: {
  message: string;
  onRetry: () => void;
  onManual: () => void;
}) {
  return (
    <Card
      className="border-danger/30 mx-auto w-full max-w-2xl p-6 text-center sm:p-8"
      role="alert"
    >
      <span className="bg-danger-soft text-danger mx-auto grid size-12 place-items-center rounded-2xl">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl font-extrabold">
        Local extraction could not finish
      </h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-lg text-sm leading-6">
        {message}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry}>
          <RotateCcw className="size-4" /> Try another file
        </Button>
        <Button variant="outline" onClick={onManual}>
          <Keyboard className="size-4" /> Enter this timetable manually
        </Button>
      </div>
    </Card>
  );
}

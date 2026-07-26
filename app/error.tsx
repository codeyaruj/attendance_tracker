"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      className="bg-background grid min-h-dvh place-items-center p-6 text-center"
      data-error-digest={error.digest}
    >
      <div className="border-border bg-surface max-w-md rounded-3xl border p-8 shadow-sm">
        <span className="bg-danger-soft text-danger-strong mx-auto grid size-12 place-items-center rounded-2xl">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-4 text-2xl font-extrabold">
          AttendSafe hit a snag
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Your local data has not been intentionally cleared. Try rendering this
          screen again.
        </p>
        <Button className="mt-6" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    </main>
  );
}

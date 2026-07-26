import { AlertTriangle, Database, LoaderCircle } from "lucide-react";

import { Card } from "@/components/ui/card";

export function AttendanceLoadingState({
  label = "Loading your attendance",
}: {
  label?: string;
}) {
  return (
    <Card
      className="grid min-h-64 place-items-center p-8 text-center"
      role="status"
    >
      <div>
        <LoaderCircle
          className="text-primary mx-auto size-7 animate-spin"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold">{label}…</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Reading the private copy saved on this device.
        </p>
      </div>
    </Card>
  );
}

export function AttendanceUnavailableState({
  kind,
  message,
}: {
  kind: "UNSUPPORTED" | "CORRUPT" | "ERROR";
  message?: string;
}) {
  const unsupported = kind === "UNSUPPORTED";
  return (
    <Card
      className="grid min-h-64 place-items-center p-8 text-center"
      role="alert"
    >
      <div className="max-w-md">
        {unsupported ? (
          <Database
            className="text-warning-strong mx-auto size-8"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="text-danger mx-auto size-8"
            aria-hidden="true"
          />
        )}
        <h2 className="font-display mt-4 text-xl font-extrabold">
          {unsupported
            ? "Local storage is unavailable"
            : "Attendance data could not be opened"}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {message ??
            (unsupported
              ? "Use a modern browser with private device storage enabled."
              : "Your data is still on this device. Reload the page and try again.")}
        </p>
      </div>
    </Card>
  );
}

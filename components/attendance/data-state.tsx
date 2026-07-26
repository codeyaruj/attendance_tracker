"use client";

import {
  AlertTriangle,
  Database,
  Download,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";
import { attendSafeRepository, DATABASE_SCHEMA_VERSION } from "@/db";

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
  onRetry,
  onResetComplete,
}: {
  kind: "UNSUPPORTED" | "CORRUPT" | "ERROR";
  message?: string;
  onRetry?: () => void | Promise<void>;
  onResetComplete?: () => void;
}) {
  const unsupported = kind === "UNSUPPORTED";
  if (!unsupported) {
    return (
      <DatabaseRecoveryState
        message={message}
        kind={kind}
        onRetry={onRetry}
        onResetComplete={onResetComplete}
      />
    );
  }
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

function downloadRecovery(json: string, partial: boolean): void {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `attendsafe-${partial ? "partial-" : ""}recovery-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DatabaseRecoveryState({
  message,
  kind = "CORRUPT",
  onRetry,
  onResetComplete,
}: {
  message?: string;
  kind?: "CORRUPT" | "ERROR";
  onRetry?: () => void | Promise<void>;
  onResetComplete?: () => void;
}) {
  const [status, setStatus] = useState<
    "IDLE" | "RETRYING" | "EXPORTING" | "RESETTING"
  >("IDLE");
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [timestamp] = useState(() => new Date().toISOString());

  const retry = async () => {
    setStatus("RETRYING");
    setRecoveryError("");
    try {
      const health = await attendSafeRepository.retryDatabase();
      if (health.status !== "READY") {
        throw new Error("The local database is still unavailable.");
      }
      await onRetry?.();
      toast.success("Local database reopened");
    } catch {
      setRecoveryError(
        "Retry did not succeed. You can export readable records before resetting.",
      );
    } finally {
      setStatus("IDLE");
    }
  };

  const exportRecovery = async () => {
    setStatus("EXPORTING");
    setRecoveryError("");
    try {
      const recovered = await attendSafeRepository.exportRecoverableData();
      downloadRecovery(recovered.json, recovered.partial);
      toast.success(
        recovered.partial
          ? "Partial recovery file downloaded"
          : "Readable recovery file downloaded",
      );
    } catch {
      setRecoveryError("No local tables could be exported safely.");
    } finally {
      setStatus("IDLE");
    }
  };

  const reset = async () => {
    if (confirmation !== "RESET") return;
    setStatus("RESETTING");
    setRecoveryError("");
    try {
      await attendSafeRepository.resetCorruptDatabase(confirmation);
      setResetOpen(false);
      if (onResetComplete) onResetComplete();
      else window.location.assign("/");
    } catch {
      setRecoveryError(
        "The local database could not be reset. Browser storage may be blocked.",
      );
      setStatus("IDLE");
    }
  };

  return (
    <>
      <Card
        className="mx-auto grid min-h-64 max-w-2xl place-items-center p-8 text-center"
        role="alert"
      >
        <div className="max-w-xl">
          <AlertTriangle
            className="text-danger mx-auto size-8"
            aria-hidden="true"
          />
          <h2 className="font-display mt-4 text-xl font-extrabold">
            Local database recovery
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {message ??
              "AttendSafe could not open its local database. No data has been deleted automatically."}
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-5">
            Retry first. If that fails, export any readable records before
            resetting. Reset permanently deletes all local attendance data.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button disabled={status !== "IDLE"} onClick={() => void retry()}>
              <RotateCcw className="size-4" />
              {status === "RETRYING" ? "Retrying…" : "Retry"}
            </Button>
            <Button
              variant="outline"
              disabled={status !== "IDLE"}
              onClick={() => void exportRecovery()}
            >
              <Download className="size-4" />
              {status === "EXPORTING"
                ? "Exporting…"
                : "Export recoverable data"}
            </Button>
            <Button
              variant="danger"
              disabled={status !== "IDLE"}
              onClick={() => setResetOpen(true)}
            >
              <Trash2 className="size-4" /> Reset database
            </Button>
          </div>
          {recoveryError ? (
            <p
              className="text-danger mt-4 text-sm font-semibold"
              aria-live="assertive"
            >
              {recoveryError}
            </p>
          ) : null}
          <details className="border-border mt-5 rounded-xl border p-3 text-left text-xs">
            <summary className="cursor-pointer font-bold">
              Technical diagnostics
            </summary>
            <dl className="text-muted-foreground mt-2 grid gap-1 break-words">
              <div>
                Error category:{" "}
                {kind === "CORRUPT"
                  ? "DATABASE_CORRUPT"
                  : "DATABASE_UNAVAILABLE"}
              </div>
              <div>Expected database version: {DATABASE_SCHEMA_VERSION}</div>
              <div>
                Browser:{" "}
                {typeof navigator === "undefined"
                  ? "unknown"
                  : navigator.userAgent}
              </div>
              <div>Timestamp: {timestamp}</div>
            </dl>
          </details>
        </div>
      </Card>

      <Dialog
        open={resetOpen}
        onClose={() => {
          if (status !== "RESETTING") setResetOpen(false);
        }}
        title="Permanently reset local data?"
        description="Export recoverable data first if possible. This action cannot be undone."
      >
        <div className="grid gap-4">
          <p className="text-danger-strong text-sm font-semibold">
            Every local profile, semester, timetable, source file, and
            attendance record will be deleted.
          </p>
          <Field label='Type "RESET" to continue'>
            <Input
              value={confirmation}
              disabled={status === "RESETTING"}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={status === "RESETTING"}
              onClick={() => setResetOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmation !== "RESET" || status === "RESETTING"}
              onClick={() => void reset()}
            >
              {status === "RESETTING" ? "Resetting…" : "Delete all local data"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

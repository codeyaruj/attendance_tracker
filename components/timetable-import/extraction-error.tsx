"use client";

import {
  AlertTriangle,
  Keyboard,
  RotateCcw,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";

export function ExtractionError({
  message,
  onRetry,
  onManual,
  onAi,
  aiAvailable,
  aiBusy = false,
  aiError,
}: {
  message: string;
  onRetry: () => void;
  onManual: () => void;
  onAi?: () => Promise<void>;
  aiAvailable?: boolean;
  aiBusy?: boolean;
  aiError?: string;
}) {
  const [consentOpen, setConsentOpen] = useState(false);
  return (
    <>
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
          {message ||
            "AttendSafe could not reliably detect the timetable structure. Try another image, enter it manually, or use AI online."}
        </p>
        {onAi ? (
          <div className="mt-6">
            <Button
              size="lg"
              className="w-full sm:w-auto"
              disabled={!aiAvailable || aiBusy}
              onClick={() => setConsentOpen(true)}
              data-testid="use-ai-timetable"
            >
              {aiBusy ? (
                "Reading schedule with AI…"
              ) : aiAvailable ? (
                <>
                  <Sparkles className="size-5" />
                  {aiError ? "Try AI again" : "Use AI to Read Schedule"}
                </>
              ) : (
                <>
                  <WifiOff className="size-5" /> AI requires internet
                </>
              )}
            </Button>
            <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-xs leading-5">
              AI analysis sends only this timetable image and limited extraction
              details to Google Gemini. Your profile, attendance records, saved
              timetables, and backups are not uploaded.
            </p>
          </div>
        ) : null}
        {aiError ? (
          <p className="text-danger-strong mt-3 text-sm" role="status">
            {aiError}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant={onAi ? "outline" : "primary"} onClick={onRetry}>
            <RotateCcw className="size-4" /> Try another file
          </Button>
          <Button variant="outline" onClick={onManual}>
            <Keyboard className="size-4" /> Enter timetable manually
          </Button>
        </div>
      </Card>

      <Dialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Use AI to read this schedule?"
        description="The selected image will leave this device only after you continue."
      >
        <div className="grid gap-4 text-sm leading-6">
          <p>
            AttendSafe will upload only the timetable image you selected and
            limited text or grid hints from local extraction to Google Gemini.
          </p>
          <p>
            Your profile, attendance history, percentages, saved timetables, and
            backups will not be uploaded.
          </p>
          <p className="text-muted-foreground">
            AI results can contain mistakes. You will review and edit every
            class before anything is saved.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConsentOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConsentOpen(false);
                void onAi?.();
              }}
            >
              Continue with AI
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

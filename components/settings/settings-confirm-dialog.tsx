"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";

export interface DestructiveConfirmation {
  id: "ATTENDANCE" | "SEMESTER" | "PROFILE" | "APP";
  title: string;
  description: string;
  confirmLabel: string;
  confirmationText: string;
}

export function SettingsConfirmDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action?: DestructiveConfirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");

  const matches = typed.trim() === action?.confirmationText;
  const close = () => {
    setTyped("");
    onClose();
  };

  return (
    <Dialog
      open={Boolean(action)}
      onClose={busy ? () => undefined : close}
      title={action?.title ?? "Confirm destructive action"}
      description={action?.description}
    >
      <div className="bg-danger-soft text-danger-strong rounded-2xl p-4 text-sm">
        <div className="flex gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <p>
            This cannot be undone. Export a JSON backup first if you may need
            this data again.
          </p>
        </div>
      </div>
      <div className="mt-5">
        <Field
          label={`Type ${action?.confirmationText ?? "the confirmation text"} to continue`}
        >
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="destructive-confirmation-input"
          />
        </Field>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={close} disabled={busy}>
          Keep my data
        </Button>
        <Button
          variant="danger"
          disabled={!matches || busy}
          onClick={() => {
            setTyped("");
            void onConfirm();
          }}
          data-testid="destructive-confirmation-submit"
        >
          {busy ? "Working…" : (action?.confirmLabel ?? "Confirm")}
        </Button>
      </div>
    </Dialog>
  );
}

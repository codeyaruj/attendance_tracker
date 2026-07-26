"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export interface ConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
}

export function ConfirmActionDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action?: ConfirmAction;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={Boolean(action)}
      onClose={busy ? () => undefined : onClose}
      title={action?.title ?? "Confirm change"}
      description={action?.description}
    >
      <div className="bg-warning-soft text-warning-strong rounded-2xl p-4 text-sm">
        <div className="flex gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <p>
            This updates the attendance saved on this device. Recent changes can
            be undone.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Keep as is
        </Button>
        <Button
          variant={action?.tone === "danger" ? "danger" : "primary"}
          onClick={() => void onConfirm()}
          disabled={busy}
          data-testid="confirm-action"
        >
          {busy ? "Saving…" : (action?.confirmLabel ?? "Confirm")}
        </Button>
      </div>
    </Dialog>
  );
}

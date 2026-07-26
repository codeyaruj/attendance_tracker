"use client";

import { LogOut, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";
import { attendSafeRepository } from "@/db";

async function leaveDemo(destination: "/" | "/?new-profile=1") {
  await attendSafeRepository.exitDemo();
  window.location.assign(destination);
}

export function DemoExitButton({
  variant = "outline",
  size = "sm",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const exit = async (destination: "/" | "/?new-profile=1") => {
    setBusy(true);
    try {
      await leaveDemo(destination);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Demo mode could not be exited.",
      );
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        data-testid="exit-demo"
      >
        <LogOut className="size-4" aria-hidden="true" /> Exit demo
      </Button>
      <Dialog
        open={open}
        onClose={busy ? () => undefined : () => setOpen(false)}
        title="Exit demo"
        description="Your demo data will stay on this device until you choose to delete it."
      >
        <div className="grid gap-3">
          <Button
            className="justify-start"
            disabled={busy}
            onClick={() => void exit("/")}
          >
            <LogOut className="size-4" aria-hidden="true" /> Start fresh setup
          </Button>
          <Button
            variant="secondary"
            className="justify-start"
            disabled={busy}
            onClick={() => void exit("/?new-profile=1")}
          >
            <UserPlus className="size-4" aria-hidden="true" /> Create a real
            profile
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Stay in demo
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function DemoProfileActions() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const createRealProfile = async () => {
    setBusy(true);
    try {
      await leaveDemo("/?new-profile=1");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Demo mode could not be exited.",
      );
      setBusy(false);
    }
  };

  const deleteDemo = async () => {
    if (confirmation !== "DELETE DEMO") return;
    setBusy(true);
    try {
      await attendSafeRepository.deleteDemo(true);
      toast.success("Demo data deleted");
      window.location.assign("/");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Demo data could not be deleted.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="border-warning/40 bg-warning-soft/50 mb-5 rounded-2xl border p-4">
      <p className="font-bold">Demo profile</p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        Leave the demo without deleting it, or create a separate real profile.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <DemoExitButton />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void createRealProfile()}
        >
          <UserPlus className="size-4" aria-hidden="true" /> Create real profile
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete demo data
        </Button>
      </div>
      <Dialog
        open={deleteOpen}
        onClose={busy ? () => undefined : () => setDeleteOpen(false)}
        title="Delete demo data?"
        description="This deletes only the demo profile. Your real profiles and exported backup files are not affected."
      >
        <Field label='Type "DELETE DEMO" to continue'>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Keep demo data
          </Button>
          <Button
            variant="danger"
            disabled={busy || confirmation !== "DELETE DEMO"}
            onClick={() => void deleteDemo()}
          >
            Delete demo data
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

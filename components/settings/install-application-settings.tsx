"use client";

import { CheckCircle2, Download, ExternalLink, Smartphone } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAppInstall } from "@/hooks/use-app-install";

import { SettingsSection } from "./settings-section";

export function InstallApplicationSettings() {
  const { method, outcome, promptNativeInstall } = useAppInstall();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const instructionsTriggerRef = useRef<HTMLButtonElement>(null);

  const closeInstructions = () => {
    setInstructionsOpen(false);
    window.setTimeout(() =>
      instructionsTriggerRef.current?.focus({ preventScroll: true }),
    );
  };

  const activate = async () => {
    if (method === "NATIVE") await promptNativeInstall();
    else setInstructionsOpen(true);
  };
  const label =
    method === "CHECKING"
      ? "Checking installation support…"
      : method === "INSTALLED"
        ? "App installed"
        : outcome === "INSTALLING"
          ? "Installing…"
          : method === "IOS"
            ? "Install using Safari"
            : method === "NATIVE"
              ? "Install App"
              : "View installation steps";

  return (
    <>
      <SettingsSection
        id="install-application"
        icon={Download}
        title="Install application"
        description="Install AttendSafe from the permanent HTTPS address for an app-like window and reliable offline shell. Installation does not copy data between devices."
      >
        <div className="border-border flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold">
              {method === "INSTALLED"
                ? "AttendSafe is running as an installed app"
                : "Add AttendSafe to this device"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {method === "EMBEDDED"
                ? "Open this page in your main browser before installing."
                : method === "IOS"
                  ? "iPhone and iPad installation uses Safari’s Share menu."
                  : method === "BROWSER_MENU"
                    ? "If no native prompt appears, use your browser menu’s Install app or Add to Home screen command."
                    : "Your existing local records remain tied to this exact browser and website origin."}
            </p>
            {outcome === "DISMISSED" ? (
              <p className="text-warning-strong mt-2 text-sm" role="status">
                Installation was dismissed. You can try again from the browser
                menu.
              </p>
            ) : null}
          </div>
          {method === "INSTALLED" ? (
            <span
              className="text-success-strong inline-flex min-h-11 items-center gap-2 font-bold"
              role="status"
            >
              <CheckCircle2 className="size-5" /> App installed
            </span>
          ) : (
            <Button
              ref={instructionsTriggerRef}
              className="min-h-11 shrink-0"
              disabled={method === "CHECKING" || outcome === "INSTALLING"}
              onClick={() => void activate()}
            >
              <Download className="size-4" /> {label}
            </Button>
          )}
        </div>
      </SettingsSection>

      <Dialog
        open={instructionsOpen}
        onClose={closeInstructions}
        title={
          method === "IOS" ? "Install on iPhone or iPad" : "Install AttendSafe"
        }
        description="Use the permanent production address. Preview URLs and other browsers have separate local storage."
      >
        <div className="grid max-h-[65dvh] gap-4 overflow-y-auto pb-[env(safe-area-inset-bottom)] text-sm leading-6">
          {method === "IOS" ? (
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open this page in Safari.</li>
              <li>Tap the Share button.</li>
              <li>Choose “Add to Home Screen”.</li>
              <li>Tap “Add”.</li>
            </ol>
          ) : method === "EMBEDDED" ? (
            <div className="grid gap-3">
              <p className="font-bold">
                Open this page in your main browser to install the app.
              </p>
              <p>Android: open in Chrome and choose Install app.</p>
              <p>
                iPhone or iPad: open in Safari and choose Share → Add to Home
                Screen.
              </p>
            </div>
          ) : (
            <p>
              Open your browser menu and choose “Install app” or “Add to Home
              screen”. If the command is unavailable, this browser may not
              support installation for the current page.
            </p>
          )}
          <div className="bg-secondary flex items-start gap-3 rounded-xl p-3">
            {method === "IOS" ? (
              <Smartphone className="mt-1 size-5 shrink-0" />
            ) : (
              <ExternalLink className="mt-1 size-5 shrink-0" />
            )}
            <p>
              Installing does not create an account, upload records, grant
              persistent storage, or transfer data from another origin.
            </p>
          </div>
          <Button variant="outline" onClick={closeInstructions}>
            Close instructions
          </Button>
        </div>
      </Dialog>
    </>
  );
}

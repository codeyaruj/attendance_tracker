"use client";

import { Download, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { attendSafeRepository } from "@/db";
import { criticalOperationActive } from "@/lib/pwa/critical-operation";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED = "attendsafe-install-guidance-dismissed";

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function likelyIosInstallCandidate(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    typeof CSS !== "undefined" &&
    CSS.supports?.("-webkit-touch-callout", "none") &&
    !standalone()
  );
}

export function PwaLifecycle() {
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent>();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const reloading = useRef(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(INSTALL_DISMISSED) === "yes";
    const guidanceTimer = window.setTimeout(
      () => setShowIosHelp(!dismissed && likelyIosInstallCandidate()),
      0,
    );

    const captureInstall = (event: Event) => {
      event.preventDefault();
      if (!standalone() && !dismissed) {
        setInstallPrompt(event as InstallPromptEvent);
      }
    };
    window.addEventListener("beforeinstallprompt", captureInstall);

    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return () => {
        window.clearTimeout(guidanceTimer);
        window.removeEventListener("beforeinstallprompt", captureInstall);
      };
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const findWaiting = () => {
      if (!disposed && registration?.waiting) setWaiting(registration.waiting);
    };
    const controllerChanged = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((nextRegistration) => {
        registration = nextRegistration;
        findWaiting();
        nextRegistration.addEventListener("updatefound", () => {
          const installing = nextRegistration.installing;
          installing?.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              findWaiting();
            }
          });
        });
        return navigator.serviceWorker.ready;
      })
      .then(() => attendSafeRepository.updateSettings({ offlineReady: true }))
      .catch(() => undefined);

    return () => {
      disposed = true;
      window.clearTimeout(guidanceTimer);
      window.removeEventListener("beforeinstallprompt", captureInstall);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
    };
  }, []);

  const dismissInstall = () => {
    localStorage.setItem(INSTALL_DISMISSED, "yes");
    setInstallPrompt(undefined);
    setShowIosHelp(false);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(undefined);
    else dismissInstall();
  };

  const update = () => {
    if (!waiting) return;
    if (criticalOperationActive()) {
      toast.warning(
        "Finish the current OCR, backup, or recovery operation before updating.",
      );
      return;
    }
    reloading.current = false;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  if (!waiting && !installPrompt && !showIosHelp) return null;

  return (
    <aside
      className="border-border bg-surface fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-xl lg:right-6 lg:bottom-6 lg:left-auto"
      aria-live="polite"
      aria-label="Application notice"
    >
      {waiting ? (
        <div className="flex items-start gap-3">
          <RefreshCw className="text-primary mt-1 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">A new version is available.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Update when you are not editing, scanning, or importing data.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={update}>
                Update now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setWaiting(undefined)}
              >
                Later
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <Download className="text-primary mt-1 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Install AttendSafe on this device</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {installPrompt
                ? "Open it like an app. Installation does not copy data from another device."
                : "In Safari, tap Share, then Add to Home Screen. Installation does not copy data."}
            </p>
            {installPrompt ? (
              <Button size="sm" className="mt-3" onClick={() => void install()}>
                Install app
              </Button>
            ) : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={dismissInstall}
            aria-label="Dismiss installation guidance"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </aside>
  );
}

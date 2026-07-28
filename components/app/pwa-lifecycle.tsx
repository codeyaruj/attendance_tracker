"use client";

import { Download, RefreshCw, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { attendSafeRepository } from "@/db";
import { useAppInstall } from "@/hooks/use-app-install";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import { criticalOperationActive } from "@/lib/pwa/critical-operation";

export function PwaLifecycle() {
  const pathname = usePathname();
  const { data } = useAttendSafeData();
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const {
    method,
    outcome,
    promotionalDismissed,
    promptNativeInstall,
    dismissPromotion,
  } = useAppInstall();
  const reloading = useRef(false);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
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
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
    };
  }, []);

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

  const onboardingActive = pathname === "/" && !data?.activeProfile;
  const showInstall =
    method === "NATIVE" && !promotionalDismissed && !onboardingActive;
  const showUpdate = Boolean(waiting) && !onboardingActive;
  if (!showUpdate && !showInstall) return null;

  return (
    <aside
      className="border-border bg-surface fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-xl lg:right-6 lg:bottom-6 lg:left-auto"
      aria-live="polite"
      aria-label="Application notice"
    >
      {showUpdate ? (
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
      ) : showInstall ? (
        <div className="flex items-start gap-3">
          <Download className="text-primary mt-1 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Install AttendSafe on this device</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Open it like an app. Installation does not copy data from another
              device.
            </p>
            <Button
              size="sm"
              className="mt-3"
              disabled={outcome === "INSTALLING"}
              onClick={() => void promptNativeInstall()}
            >
              {outcome === "INSTALLING" ? "Installing…" : "Install app"}
            </Button>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={dismissPromotion}
            aria-label="Dismiss installation guidance"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

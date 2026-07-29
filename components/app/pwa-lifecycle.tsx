"use client";

import { Download, RefreshCw, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppInstall } from "@/hooks/use-app-install";
import { usePwaUpdate } from "@/hooks/use-pwa-update";

export function PwaLifecycle() {
  const pathname = usePathname();
  const [desktopViewport, setDesktopViewport] = useState(false);
  const pwaUpdate = usePwaUpdate();
  const {
    method,
    outcome,
    promotionalDismissed,
    promptNativeInstall,
    dismissPromotion,
  } = useAppInstall();
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setDesktopViewport(query.matches);

    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

  const onboardingActive = pathname === "/";
  const showInstall =
    desktopViewport &&
    method === "NATIVE" &&
    !promotionalDismissed &&
    !onboardingActive;
  const showUpdate = pwaUpdate.promptVisible;
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
            <p className="font-bold">
              {pwaUpdate.phase === "activating"
                ? "Updating AttendSafe…"
                : pwaUpdate.phase === "error"
                  ? "The update is still available."
                  : "A new version is available."}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {pwaUpdate.phase === "blocked"
                ? "The update will continue after your current edit, scan, import, or backup finishes."
                : pwaUpdate.phase === "error"
                  ? "AttendSafe could not finish the update. Check your connection and try again; your local data is safe."
                  : !pwaUpdate.online && !pwaUpdate.canActivateOffline
                    ? "Reconnect to download the update. Your local data remains available."
                    : "Update safely without clearing attendance or other local data."}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={pwaUpdate.phase === "activating"}
                onClick={pwaUpdate.updateNow}
              >
                {pwaUpdate.phase === "activating" ? "Updating…" : "Update now"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pwaUpdate.phase === "activating"}
                onClick={pwaUpdate.updateLater}
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

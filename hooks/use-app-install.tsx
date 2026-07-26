"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform?: string;
  }>;
}

export type InstallMethod =
  "CHECKING" | "NATIVE" | "IOS" | "EMBEDDED" | "BROWSER_MENU" | "INSTALLED";
export type InstallOutcome = "IDLE" | "INSTALLING" | "ACCEPTED" | "DISMISSED";

export interface AppInstallState {
  method: InstallMethod;
  outcome: InstallOutcome;
  promotionalDismissed: boolean;
  promptNativeInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  dismissPromotion: () => void;
}

const DISMISSED_KEY = "attendsafe-install-guidance-dismissed";
const AppInstallContext = createContext<AppInstallState | undefined>(undefined);

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function fallbackMethod(): InstallMethod {
  if (isStandalone()) return "INSTALLED";
  const agent = navigator.userAgent;
  if (/(?:FBAN|FBAV|Instagram|Line\/|; wv\))/i.test(agent)) return "EMBEDDED";
  const appleMobile =
    /(?:iPhone|iPad|iPod)/i.test(agent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(agent));
  return appleMobile ? "IOS" : "BROWSER_MENU";
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "yes";
  } catch {
    return false;
  }
}

export function AppInstallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [method, setMethod] = useState<InstallMethod>("CHECKING");
  const [outcome, setOutcome] = useState<InstallOutcome>("IDLE");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent>();
  const [promotionalDismissed, setPromotionalDismissed] = useState(false);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      setPromotionalDismissed(readDismissed());
      setMethod(fallbackMethod());
    }, 0);
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const refreshInstalledMode = () => {
      if (isStandalone()) setMethod("INSTALLED");
    };
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      if (isStandalone()) return;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setOutcome("IDLE");
      setMethod("NATIVE");
    };
    const installed = () => {
      setDeferredPrompt(undefined);
      setOutcome("ACCEPTED");
      setMethod("INSTALLED");
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    displayMode?.addEventListener?.("change", refreshInstalledMode);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      displayMode?.removeEventListener?.("change", refreshInstalledMode);
    };
  }, []);

  const promptNativeInstall = useCallback(async () => {
    if (!deferredPrompt || method !== "NATIVE") return "unavailable" as const;
    setOutcome("INSTALLING");
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(undefined);
      setOutcome(choice.outcome === "accepted" ? "ACCEPTED" : "DISMISSED");
      setMethod(fallbackMethod());
      return choice.outcome;
    } catch {
      setDeferredPrompt(undefined);
      setOutcome("DISMISSED");
      setMethod(fallbackMethod());
      return "dismissed" as const;
    }
  }, [deferredPrompt, method]);

  const dismissPromotion = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "yes");
    } catch {
      // The permanent Settings control remains available if storage is blocked.
    }
    setPromotionalDismissed(true);
  }, []);

  const value = useMemo(
    () => ({
      method,
      outcome,
      promotionalDismissed,
      promptNativeInstall,
      dismissPromotion,
    }),
    [
      method,
      outcome,
      promotionalDismissed,
      promptNativeInstall,
      dismissPromotion,
    ],
  );
  return (
    <AppInstallContext.Provider value={value}>
      {children}
    </AppInstallContext.Provider>
  );
}

export function useAppInstall(): AppInstallState {
  const value = useContext(AppInstallContext);
  if (!value) {
    throw new Error("useAppInstall must be used inside AppInstallProvider");
  }
  return value;
}

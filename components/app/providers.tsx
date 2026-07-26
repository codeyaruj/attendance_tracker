"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

import { AppInstallProvider } from "@/hooks/use-app-install";

import { PwaLifecycle } from "./pwa-lifecycle";

function applyStoredTheme(): void {
  const stored = localStorage.getItem("attendsafe-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle(
    "dark",
    stored === "dark" || (stored !== "light" && prefersDark),
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyStoredTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyStoredTheme();
    media.addEventListener("change", listener);

    return () => media.removeEventListener("change", listener);
  }, []);

  return (
    <AppInstallProvider>
      {children}
      <PwaLifecycle />
      <Toaster position="top-center" richColors closeButton />
    </AppInstallProvider>
  );
}

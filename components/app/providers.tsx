"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

import { attendSafeRepository } from "@/db";

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

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => attendSafeRepository.updateSettings({ offlineReady: true }))
        .catch(() => undefined);
    }

    return () => media.removeEventListener("change", listener);
  }, []);

  return (
    <>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}

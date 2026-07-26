"use client";

import {
  CalendarCheck2,
  CalendarDays,
  Gauge,
  GraduationCap,
  History,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./brand";
import { OfflineIndicator } from "./offline-indicator";
import { Button } from "@/components/ui/button";
import { attendSafeRepository } from "@/db";
import { useAttendSafeData } from "@/hooks/use-attendsafe-data";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/today", label: "Today", icon: CalendarCheck2 },
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/timetable", label: "Timetable", icon: CalendarDays },
  { href: "/skip-planner", label: "Skip Planner", icon: ShieldCheck },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const pageTitles: Record<string, { title: string; eyebrow: string }> = {
  "/today": { title: "Today", eyebrow: "Daily check-in" },
  "/dashboard": { title: "Attendance overview", eyebrow: "Dashboard" },
  "/timetable": { title: "Weekly timetable", eyebrow: "Your schedule" },
  "/skip-planner": {
    title: "What can I skip?",
    eyebrow: "Plan with confidence",
  },
  "/history": { title: "Attendance history", eyebrow: "Review & correct" },
  "/settings": { title: "Settings", eyebrow: "Profiles, semester & backup" },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useAttendSafeData();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const current = pageTitles[pathname] ?? pageTitles["/dashboard"];

  useEffect(() => {
    const syncTheme = () =>
      setDark(document.documentElement.classList.contains("dark"));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("attendsafe-theme", next ? "dark" : "light");
    void attendSafeRepository
      .updateSettings({ theme: next ? "DARK" : "LIGHT" })
      .catch(() => undefined);
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-border bg-surface fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r px-4 py-5 lg:flex lg:flex-col">
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-9 grid gap-1" aria-label="Primary navigation">
          {navigation.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-primary flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  active && "bg-primary-soft text-primary",
                )}
              >
                <item.icon
                  className="size-5"
                  strokeWidth={active ? 2.4 : 2}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-border bg-background mt-auto rounded-2xl border p-4">
          <div className="flex items-center gap-3">
            <span className="bg-primary-soft text-primary grid size-9 place-items-center rounded-xl">
              <GraduationCap className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {data?.activeProfile?.displayName ?? "My semester"}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {data?.activeSemester?.name ?? "Stored on this device"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/40 lg:hidden"
          role="presentation"
        >
          <aside className="bg-surface h-full w-[min(84vw,320px)] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="size-5" />
              </Button>
            </div>
            <nav className="mt-8 grid gap-1" aria-label="Mobile menu">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "text-muted-foreground flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold",
                    pathname === item.href && "bg-primary-soft text-primary",
                  )}
                >
                  <item.icon className="size-5" aria-hidden="true" />
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      <div className="min-w-0 lg:col-start-2">
        <header className="border-border/80 bg-background/90 sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open menu"
                onClick={() => setMenuOpen(true)}
              >
                <Menu className="size-5" />
              </Button>
              <div className="min-w-0">
                <p className="text-primary text-[11px] font-bold tracking-[0.16em] uppercase">
                  {current.eyebrow}
                </p>
                <h1 className="font-display truncate text-lg font-extrabold tracking-tight sm:text-xl">
                  {current.title}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:block">
                <OfflineIndicator />
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
              >
                {dark ? (
                  <Sun className="size-5" />
                ) : (
                  <Moon className="size-5" />
                )}
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-7 lg:pb-10">
          {children}
        </main>
      </div>

      <nav
        className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-40 border-t px-1 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.35rem)] backdrop-blur-xl lg:hidden"
        aria-label="Bottom navigation"
      >
        <div className="mx-auto grid max-w-lg grid-cols-6">
          {navigation.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-muted-foreground focus-visible:ring-primary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold focus-visible:ring-2 focus-visible:outline-none",
                  active && "text-primary",
                )}
              >
                <item.icon
                  className="size-5"
                  strokeWidth={active ? 2.6 : 2}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate">
                  {item.label === "Skip Planner" ? "Skip" : item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

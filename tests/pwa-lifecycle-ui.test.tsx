import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PwaLifecycle } from "@/components/app/pwa-lifecycle";

let pathname = "/";
const updateNow = vi.fn();
const updateLater = vi.fn();
const updateState = {
  phase: "available" as const,
  promptVisible: true,
  canActivateOffline: true,
  online: true,
  updateNow,
  updateLater,
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));
vi.mock("@/hooks/use-pwa-update", () => ({
  usePwaUpdate: () => updateState,
}));
vi.mock("@/hooks/use-app-install", () => ({
  useAppInstall: () => ({
    method: "NONE",
    outcome: "IDLE",
    promotionalDismissed: false,
    promptNativeInstall: vi.fn(),
    dismissPromotion: vi.fn(),
  }),
}));

describe("PWA update prompt", () => {
  beforeEach(() => {
    pathname = "/";
    updateNow.mockClear();
    updateLater.mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("is accessible and visible on the root onboarding route", () => {
    render(<PwaLifecycle />);
    expect(
      screen.getByRole("complementary", { name: "Application notice" }),
    ).toBeVisible();
    expect(screen.getByText("A new version is available.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(updateNow).toHaveBeenCalledOnce();
    expect(updateLater).toHaveBeenCalledOnce();
  });

  it("also appears on a local-data route", () => {
    pathname = "/today/";
    render(<PwaLifecycle />);
    expect(screen.getByText("A new version is available.")).toBeVisible();
  });
});

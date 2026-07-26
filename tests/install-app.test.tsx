import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstallApplicationSettings } from "@/components/settings/install-application-settings";
import { AppInstallProvider, useAppInstall } from "@/hooks/use-app-install";

const originalUserAgent = navigator.userAgent;
const originalTouchPoints = navigator.maxTouchPoints;

function matchMedia(matches = false): typeof window.matchMedia {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === "(display-mode: standalone)" ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function setNavigator(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
}

function StateHarness() {
  const state = useAppInstall();
  return (
    <div>
      <output>{`${state.method}:${state.outcome}`}</output>
      <button onClick={() => void state.promptNativeInstall()}>Prompt</button>
      <button onClick={state.dismissPromotion}>Dismiss promotion</button>
      <span>{state.promotionalDismissed ? "dismissed" : "visible"}</span>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setNavigator(originalUserAgent, originalTouchPoints);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMedia(false),
  });
});

describe("application installation", () => {
  it("captures, prevents, invokes, and clears a dismissed native prompt", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia(false),
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: prompt },
      userChoice: { value: Promise.resolve({ outcome: "dismissed" }) },
    });
    render(
      <AppInstallProvider>
        <StateHarness />
      </AppInstallProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("BROWSER_MENU:IDLE")).toBeVisible(),
    );
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText("NATIVE:IDLE")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(screen.getByText("BROWSER_MENU:DISMISSED")).toBeVisible();
  });

  it("marks installation only after appinstalled and retains promo dismissal", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia(false),
    });
    render(
      <AppInstallProvider>
        <StateHarness />
      </AppInstallProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("BROWSER_MENU:IDLE")).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss promotion" }));
    expect(localStorage.getItem("attendsafe-install-guidance-dismissed")).toBe(
      "yes",
    );
    act(() => window.dispatchEvent(new Event("appinstalled")));
    await waitFor(() =>
      expect(screen.getByText("INSTALLED:ACCEPTED")).toBeVisible(),
    );
    expect(screen.getByText("dismissed")).toBeVisible();
  });

  it("detects standalone mode and hides the installation action", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia(true),
    });
    render(
      <AppInstallProvider>
        <InstallApplicationSettings />
      </AppInstallProvider>,
    );
    expect(await screen.findByText("App installed")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Install App/i })).toBeNull();
  });

  it("shows accessible iPhone and iPad Safari instructions", async () => {
    setNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari",
      5,
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia(false),
    });
    render(
      <AppInstallProvider>
        <InstallApplicationSettings />
      </AppInstallProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Install using Safari" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Install on iPhone or iPad",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/Choose “Add to Home Screen”/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close instructions" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("provides conservative embedded-browser guidance", async () => {
    setNavigator("Mozilla/5.0 Instagram 320.0 Android", 5);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia(false),
    });
    render(
      <AppInstallProvider>
        <InstallApplicationSettings />
      </AppInstallProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "View installation steps" }),
    );
    expect(
      screen.getByText(
        "Open this page in your main browser to install the app.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Android: open in Chrome/)).toBeVisible();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeviceStorageSettings } from "@/components/settings/device-storage-settings";
import {
  clearDownloadedAppFiles,
  getDeviceStorageStatus,
  requestPersistentStorage,
} from "@/lib/pwa/storage";

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  if (originalStorage)
    Object.defineProperty(navigator, "storage", originalStorage);
  else Reflect.deleteProperty(navigator, "storage");
});

function mockStorage({ persistent = false, granted = false } = {}) {
  const persist = vi.fn(async () => granted);
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      estimate: vi.fn(async () => ({ usage: 2_000_000, quota: 20_000_000 })),
      persisted: vi.fn(async () => persistent),
      persist,
    },
  });
  return persist;
}

describe("device storage controls", () => {
  it("reports unsupported browsers without breaking the app", async () => {
    Reflect.deleteProperty(navigator, "storage");
    await expect(getDeviceStorageStatus()).resolves.toMatchObject({
      supported: false,
      persistenceAttempted: false,
    });
  });

  it("requests persistence only once after an explicit action", async () => {
    const persist = mockStorage({ granted: true });
    await requestPersistentStorage();
    await requestPersistentStorage();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("continues with accurate UI when persistence is denied", async () => {
    const persist = mockStorage({ granted: false });
    render(<DeviceStorageSettings offlineReady />);
    const button = await screen.findByRole("button", {
      name: "Protect local data",
    });
    fireEvent.click(button);
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    await screen.findByText("Not granted");
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/cannot protect against clearing browser data/i),
    ).toBeVisible();
  });

  it("clears only AttendSafe Cache Storage entries", async () => {
    const remove = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => [
        "attendsafe-shell-v3",
        "attendsafe-ocr-v4",
        "another-application-v1",
      ]),
      delete: remove,
    });
    await expect(clearDownloadedAppFiles()).resolves.toBe(2);
    expect(remove).toHaveBeenCalledWith("attendsafe-shell-v3");
    expect(remove).toHaveBeenCalledWith("attendsafe-ocr-v4");
    expect(remove).not.toHaveBeenCalledWith("another-application-v1");
  });
});

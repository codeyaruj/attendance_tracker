import { afterEach, describe, expect, it, vi } from "vitest";

import {
  notificationSupport,
  requestNotificationPermission,
  showLocalNotification,
} from "@/lib/notifications";

const originalNotification = Object.getOwnPropertyDescriptor(
  window,
  "Notification",
);
const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

afterEach(() => {
  if (originalNotification) {
    Object.defineProperty(window, "Notification", originalNotification);
  } else {
    Reflect.deleteProperty(window, "Notification");
  }
  if (originalServiceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
});

describe("local notification architecture", () => {
  it("reports unsupported browsers without requesting permission", async () => {
    Reflect.deleteProperty(window, "Notification");

    expect(notificationSupport()).toBe("UNSUPPORTED");
    await expect(requestNotificationPermission()).resolves.toBe("UNSUPPORTED");
    await expect(
      showLocalNotification({ title: "Class reminder", body: "DSP at 9" }),
    ).resolves.toBe(false);
  });

  it("requests permission and routes granted notifications through the service worker", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission },
    });
    const showNotification = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ showNotification }) },
    });

    expect(notificationSupport()).toBe("granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    await expect(
      showLocalNotification({
        title: "Class reminder",
        body: "DSP at 9",
        tag: "class-dsp",
      }),
    ).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      "Class reminder",
      expect.objectContaining({
        body: "DSP at 9",
        tag: "class-dsp",
        data: { url: "/today" },
      }),
    );
  });
});

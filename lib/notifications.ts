export interface AttendanceNotification {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export function notificationSupport(): "UNSUPPORTED" | NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "UNSUPPORTED";
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "UNSUPPORTED"
> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "UNSUPPORTED";
  }
  return Notification.requestPermission();
}

export async function showLocalNotification(
  notification: AttendanceNotification,
): Promise<boolean> {
  if (
    notificationSupport() !== "granted" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    data: { url: notification.url ?? "/today" },
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });
  return true;
}

export const OWNED_CACHE_PREFIXES = [
  "attendsafe-shell-",
  "attendsafe-static-",
  "attendsafe-ocr-",
] as const;

const PERSISTENCE_ATTEMPTED_KEY = "attendsafe-persistence-requested";
const LAST_BACKUP_KEY = "attendsafe-last-backup";

export interface DeviceStorageStatus {
  supported: boolean;
  persistent?: boolean;
  usage?: number;
  quota?: number;
  persistenceAttempted: boolean;
  lastBackupAt?: string;
}

export async function getDeviceStorageStatus(): Promise<DeviceStorageStatus> {
  const storage =
    typeof navigator === "undefined" ? undefined : navigator.storage;
  const supported = Boolean(storage?.estimate);
  const persistenceAttempted =
    typeof localStorage !== "undefined" &&
    localStorage.getItem(PERSISTENCE_ATTEMPTED_KEY) === "yes";
  const lastBackupAt =
    typeof localStorage === "undefined"
      ? undefined
      : localStorage.getItem(LAST_BACKUP_KEY) || undefined;
  if (!supported) return { supported, persistenceAttempted, lastBackupAt };

  const [persistent, estimate] = await Promise.all([
    storage?.persisted?.().catch(() => undefined),
    storage?.estimate?.().catch(() => undefined),
  ]);
  return {
    supported,
    persistent,
    usage: estimate?.usage,
    quota: estimate?.quota,
    persistenceAttempted,
    lastBackupAt,
  };
}

export async function requestPersistentStorage(): Promise<DeviceStorageStatus> {
  if (localStorage.getItem(PERSISTENCE_ATTEMPTED_KEY) === "yes") {
    return getDeviceStorageStatus();
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PERSISTENCE_ATTEMPTED_KEY, "yes");
  }
  await navigator.storage?.persist?.().catch(() => false);
  return getDeviceStorageStatus();
}

export function recordBackupGenerated(at = new Date().toISOString()): void {
  localStorage.setItem(LAST_BACKUP_KEY, at);
  window.dispatchEvent(new Event("attendsafe-storage-status"));
}

export async function clearDownloadedAppFiles(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const names = await caches.keys();
  const owned = names.filter((name) =>
    OWNED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  await Promise.all(owned.map((name) => caches.delete(name)));
  return owned.length;
}

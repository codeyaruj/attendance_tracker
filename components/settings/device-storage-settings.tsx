"use client";

import { HardDrive, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  clearDownloadedAppFiles,
  getDeviceStorageStatus,
  requestPersistentStorage,
  type DeviceStorageStatus,
} from "@/lib/pwa/storage";

function bytes(value?: number): string {
  if (value === undefined) return "Unavailable";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function DeviceStorageSettings({
  offlineReady,
}: {
  offlineReady: boolean;
}) {
  const [status, setStatus] = useState<DeviceStorageStatus>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    void getDeviceStorageStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("attendsafe-storage-status", refresh);
    return () =>
      window.removeEventListener("attendsafe-storage-status", refresh);
  }, [refresh]);

  const requestPersistence = async () => {
    setBusy(true);
    try {
      const next = await requestPersistentStorage();
      setStatus(next);
      toast[next.persistent ? "success" : "info"](
        next.persistent
          ? "Persistent storage granted on this device"
          : "The browser did not grant persistence; AttendSafe will continue normally.",
      );
    } finally {
      setBusy(false);
    }
  };

  const clearFiles = async () => {
    setBusy(true);
    try {
      const count = await clearDownloadedAppFiles();
      toast.success(
        count > 0
          ? "Downloaded app files cleared; attendance data was preserved."
          : "No downloaded app files needed clearing.",
      );
    } catch {
      toast.error("Downloaded app files could not be cleared in this browser.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border mb-6 rounded-2xl border p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-xl">
          <Smartphone className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-bold">Storage on this device</h3>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            Records stay in this browser profile. Desktop data does not
            automatically appear on a phone, and installing the app does not
            transfer it.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="bg-secondary rounded-xl p-3">
          <dt className="text-muted-foreground">Offline app files</dt>
          <dd className="mt-1 font-bold">
            {offlineReady ? "Ready" : "Preparing after first online visit"}
          </dd>
        </div>
        <div className="bg-secondary rounded-xl p-3">
          <dt className="text-muted-foreground">Persistent storage</dt>
          <dd className="mt-1 font-bold">
            {!status?.supported
              ? "Not supported by this browser"
              : status.persistent
                ? "Granted"
                : status.persistenceAttempted
                  ? "Not granted"
                  : "Not requested"}
          </dd>
        </div>
        <div className="bg-secondary rounded-xl p-3">
          <dt className="text-muted-foreground">Approximate usage</dt>
          <dd className="mt-1 font-bold">{bytes(status?.usage)}</dd>
        </div>
        <div className="bg-secondary rounded-xl p-3">
          <dt className="text-muted-foreground">Approximate quota</dt>
          <dd className="mt-1 font-bold">{bytes(status?.quota)}</dd>
        </div>
        <div className="bg-secondary rounded-xl p-3 sm:col-span-2">
          <dt className="text-muted-foreground">Last backup generated here</dt>
          <dd className="mt-1 font-bold">
            {status?.lastBackupAt
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(status.lastBackupAt))
              : "No backup recorded in this browser"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          disabled={
            busy ||
            !status?.supported ||
            status.persistent ||
            status.persistenceAttempted
          }
          onClick={() => void requestPersistence()}
        >
          <ShieldCheck className="size-4" /> Protect local data
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void clearFiles()}
        >
          <Trash2 className="size-4" /> Clear downloaded app files
        </Button>
      </div>

      <div className="text-muted-foreground mt-4 grid gap-2 text-xs leading-5">
        <p>
          Persistent storage reduces automatic browser eviction. It cannot
          protect against clearing browser data, browser removal, device
          failure, or losing the device.
        </p>
        <p>
          To transfer devices: export a JSON backup on the old device, then
          import it on the new device. Backup files can contain timetable,
          attendance, and original timetable-source information.
        </p>
        <p className="flex items-start gap-2">
          <HardDrive className="mt-0.5 size-4 shrink-0" /> Clearing downloaded
          app files never clears IndexedDB records, but offline and OCR files
          may need to download again.
        </p>
      </div>
    </div>
  );
}

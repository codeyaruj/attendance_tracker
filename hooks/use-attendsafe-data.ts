"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  attendSafeRepository,
  isIndexedDBSupported,
  normalizeDatabaseError,
  subscribeDataVersion,
  type AttendSafeSnapshot,
} from "@/db";

export type AttendSafeDataAvailability =
  "CHECKING" | "READY" | "UNSUPPORTED" | "CORRUPT" | "ERROR";

export interface UseAttendSafeDataOptions {
  profileId?: string;
  semesterId?: string;
}

export interface UseAttendSafeDataResult {
  data?: AttendSafeSnapshot;
  loading: boolean;
  availability: AttendSafeDataAvailability;
  error?: Error;
  refresh: () => Promise<void>;
}

function classifyAvailability(error: Error): AttendSafeDataAvailability {
  if ("code" in error) {
    const code = Reflect.get(error, "code");
    if (code === "INDEXEDDB_UNAVAILABLE") return "UNSUPPORTED";
    if (code === "INDEXEDDB_CORRUPT") return "CORRUPT";
  }
  return "ERROR";
}

export function useAttendSafeData(
  options: UseAttendSafeDataOptions = {},
): UseAttendSafeDataResult {
  const mounted = useRef(false);
  const requestNumber = useRef(0);
  const [state, setState] = useState<Omit<UseAttendSafeDataResult, "refresh">>({
    loading: true,
    availability: "CHECKING",
  });

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestNumber.current;
    if (!isIndexedDBSupported()) {
      const error = new Error(
        "This browser does not support IndexedDB, so AttendSafe cannot save local data.",
      );
      if (mounted.current && request === requestNumber.current) {
        setState({ loading: false, availability: "UNSUPPORTED", error });
      }
      return;
    }
    if (mounted.current) {
      setState((current) => ({ ...current, loading: true, error: undefined }));
    }
    try {
      const data = await attendSafeRepository.getSnapshot(
        options.profileId,
        options.semesterId,
      );
      if (mounted.current && request === requestNumber.current) {
        setState({ data, loading: false, availability: "READY" });
      }
    } catch (cause) {
      const error = normalizeDatabaseError(cause);
      if (mounted.current && request === requestNumber.current) {
        setState({
          loading: false,
          availability: classifyAvailability(error),
          error,
        });
      }
    }
  }, [options.profileId, options.semesterId]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (mounted.current) void refresh();
    });
    const unsubscribe = subscribeDataVersion(() => void refresh());
    return () => {
      mounted.current = false;
      requestNumber.current += 1;
      unsubscribe();
    };
  }, [refresh]);

  return { ...state, refresh };
}

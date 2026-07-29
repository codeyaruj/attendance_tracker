"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { attendSafeRepository } from "@/db";
import {
  CRITICAL_OPERATION_EVENT,
  criticalOperationActive,
} from "@/lib/pwa/critical-operation";
import { CURRENT_BUILD_ID, fetchDeployedBuild } from "@/lib/pwa/build-version";

export const PWA_UPDATE_INTERVAL_MS = 45 * 60 * 1000;
const RELOAD_GUARD_KEY = "attendsafe-pwa-reload";
const RELOAD_GUARD_MS = 5 * 60 * 1000;

export type PwaUpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "blocked"
  | "activating"
  | "offline"
  | "error";

type PwaUpdateState = {
  phase: PwaUpdatePhase;
  ready: boolean;
  dismissed: boolean;
  deployedBuildId?: string;
  waiting: boolean;
};

type PwaUpdateAction =
  | { type: "UNSUPPORTED" }
  | { type: "REGISTERED" }
  | { type: "CHECKING"; resurface: boolean }
  | { type: "CHECK_FAILED" }
  | { type: "CURRENT" }
  | { type: "AVAILABLE"; buildId?: string; waiting: boolean }
  | { type: "WAITING" }
  | { type: "BLOCKED" }
  | { type: "ACTIVATING" }
  | { type: "ERROR" }
  | { type: "OFFLINE" }
  | { type: "DISMISS" };

const initialState: PwaUpdateState = {
  phase: "idle",
  ready: false,
  dismissed: false,
  waiting: false,
};

export function pwaUpdateReducer(
  state: PwaUpdateState,
  action: PwaUpdateAction,
): PwaUpdateState {
  switch (action.type) {
    case "UNSUPPORTED":
      return { ...state, phase: "unsupported" };
    case "REGISTERED":
      return { ...state, ready: true };
    case "CHECKING":
      return {
        ...state,
        phase: state.phase === "available" ? state.phase : "checking",
        dismissed: action.resurface ? false : state.dismissed,
      };
    case "CHECK_FAILED":
      return state.phase === "checking" ? { ...state, phase: "idle" } : state;
    case "CURRENT":
      return state.waiting
        ? state
        : {
            ...state,
            phase: "idle",
            deployedBuildId: CURRENT_BUILD_ID,
          };
    case "AVAILABLE":
      return {
        ...state,
        phase: "available",
        deployedBuildId: action.buildId ?? state.deployedBuildId,
        waiting: action.waiting || state.waiting,
      };
    case "WAITING":
      return { ...state, phase: "available", waiting: true };
    case "BLOCKED":
      return { ...state, phase: "blocked", dismissed: false };
    case "ACTIVATING":
      return { ...state, phase: "activating", dismissed: false };
    case "ERROR":
      return { ...state, phase: "error", dismissed: false };
    case "OFFLINE":
      return state.phase === "available" || state.waiting
        ? state
        : { ...state, phase: "offline" };
    case "DISMISS":
      return { ...state, dismissed: true };
  }
}

type ReloadGuard = {
  from: string;
  target: string;
  at: number;
};

function readReloadGuard(): ReloadGuard | undefined {
  try {
    const value: unknown = JSON.parse(
      window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return;
    const guard = value as Partial<ReloadGuard>;
    if (
      typeof guard.from === "string" &&
      typeof guard.target === "string" &&
      typeof guard.at === "number"
    ) {
      return guard as ReloadGuard;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browsing modes.
  }
}

function writeReloadGuard(target: string) {
  try {
    window.sessionStorage.setItem(
      RELOAD_GUARD_KEY,
      JSON.stringify({ from: CURRENT_BUILD_ID, target, at: Date.now() }),
    );
  } catch {
    // A ref still prevents duplicate reloads during this document lifetime.
  }
}

export function usePwaUpdate() {
  const [state, dispatch] = useReducer(pwaUpdateReducer, initialState);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(
    undefined,
  );
  const waitingRef = useRef<ServiceWorker | undefined>(undefined);
  const checkRef = useRef<Promise<void> | undefined>(undefined);
  const disposedRef = useRef(false);
  const activationRequestedRef = useRef(false);
  const activationSentRef = useRef(false);
  const reloadPendingRef = useRef(false);
  const reloadingRef = useRef(false);
  const hadControllerRef = useRef(false);
  const deployedBuildRef = useRef<string | undefined>(undefined);
  const activationTimerRef = useRef<number | undefined>(undefined);

  const reloadWhenSafe = useCallback(() => {
    if (reloadingRef.current) return;
    if (criticalOperationActive()) {
      reloadPendingRef.current = true;
      dispatch({ type: "BLOCKED" });
      return;
    }
    const target = deployedBuildRef.current ?? "service-worker-update";
    const guard = readReloadGuard();
    if (
      guard?.from === CURRENT_BUILD_ID &&
      guard.target === target &&
      Date.now() - guard.at < RELOAD_GUARD_MS
    ) {
      return;
    }
    reloadingRef.current = true;
    reloadPendingRef.current = false;
    writeReloadGuard(target);
    window.location.reload();
  }, []);

  const activateWaiting = useCallback(() => {
    const waiting = waitingRef.current ?? registrationRef.current?.waiting;
    if (!waiting) return false;
    waitingRef.current = waiting;
    if (criticalOperationActive()) {
      dispatch({ type: "BLOCKED" });
      return false;
    }
    if (activationSentRef.current) return true;
    dispatch({ type: "ACTIVATING" });
    try {
      activationSentRef.current = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
      window.clearTimeout(activationTimerRef.current);
      activationTimerRef.current = window.setTimeout(
        () => dispatch({ type: "ERROR" }),
        15_000,
      );
    } catch {
      activationSentRef.current = false;
      dispatch({ type: "ERROR" });
      return false;
    }
    return true;
  }, []);

  const checkForUpdate = useCallback(
    (resurface = true) => {
      if (checkRef.current) return checkRef.current;
      if (navigator.onLine === false) {
        if (resurface) dispatch({ type: "CHECKING", resurface: true });
        dispatch({ type: "OFFLINE" });
        return Promise.resolve();
      }

      dispatch({ type: "CHECKING", resurface });
      const check = (async () => {
        const registration = registrationRef.current;
        const [versionResult] = await Promise.allSettled([
          fetchDeployedBuild(),
          registration?.update(),
        ]);
        if (disposedRef.current) return;

        const waiting = registration?.waiting;
        if (waiting) waitingRef.current = waiting;
        if (versionResult.status === "fulfilled") {
          const buildId = versionResult.value.buildId;
          deployedBuildRef.current = buildId;
          if (buildId !== CURRENT_BUILD_ID || waiting) {
            dispatch({ type: "AVAILABLE", buildId, waiting: Boolean(waiting) });
          } else {
            dispatch({ type: "CURRENT" });
          }
        } else if (waiting) {
          dispatch({ type: "WAITING" });
        } else if (navigator.onLine === false) {
          dispatch({ type: "OFFLINE" });
        } else {
          dispatch({ type: "CHECK_FAILED" });
        }

        if (activationRequestedRef.current && !activateWaiting()) {
          if (registration?.installing) dispatch({ type: "ACTIVATING" });
          else dispatch({ type: "ERROR" });
        }
      })().finally(() => {
        checkRef.current = undefined;
      });
      checkRef.current = check;
      return check;
    },
    [activateWaiting],
  );

  const updateNow = useCallback(() => {
    activationRequestedRef.current = true;
    if (criticalOperationActive()) {
      dispatch({ type: "BLOCKED" });
      return;
    }
    if (activateWaiting()) return;
    if (navigator.onLine === false) {
      dispatch({ type: "OFFLINE" });
      return;
    }
    dispatch({ type: "ACTIVATING" });
    void checkForUpdate(false);
  }, [activateWaiting, checkForUpdate]);

  const updateLater = useCallback(() => {
    activationRequestedRef.current = false;
    dispatch({ type: "DISMISS" });
  }, []);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      dispatch({ type: "UNSUPPORTED" });
      return;
    }

    let effectDisposed = false;
    let registeredForCleanup: ServiceWorkerRegistration | undefined;
    const watchedWorkers = new Map<ServiceWorker, EventListener>();
    disposedRef.current = false;
    hadControllerRef.current = Boolean(navigator.serviceWorker.controller);
    const guard = readReloadGuard();
    if (guard?.target === CURRENT_BUILD_ID) {
      window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
    }

    const workerInstalled = (
      registration: ServiceWorkerRegistration,
      worker: ServiceWorker,
    ) => {
      if (worker.state !== "installed" || disposedRef.current) return;
      if (!navigator.serviceWorker.controller && !hadControllerRef.current) {
        return;
      }
      waitingRef.current = registration.waiting ?? worker;
      activationSentRef.current = false;
      dispatch({ type: "WAITING" });
      if (activationRequestedRef.current) activateWaiting();
    };

    const watchInstalling = (registration: ServiceWorkerRegistration) => {
      const worker = registration.installing;
      if (!worker) return;
      const stateChanged = () => {
        workerInstalled(registration, worker);
        if (worker.state === "installed" || worker.state === "redundant") {
          worker.removeEventListener("statechange", stateChanged);
          watchedWorkers.delete(worker);
          if (worker.state === "redundant" && activationRequestedRef.current) {
            dispatch({ type: "ERROR" });
          }
        }
      };
      watchedWorkers.set(worker, stateChanged);
      worker.addEventListener("statechange", stateChanged);
      stateChanged();
    };

    const updateFound = () => {
      if (registeredForCleanup) watchInstalling(registeredForCleanup);
    };

    const controllerChanged = () => {
      window.clearTimeout(activationTimerRef.current);
      activationSentRef.current = false;
      if (!hadControllerRef.current) {
        hadControllerRef.current = true;
        return;
      }
      reloadWhenSafe();
    };

    const criticalOperationChanged = (event: Event) => {
      const active = (event as CustomEvent<{ active?: boolean }>).detail
        ?.active;
      if (active) return;
      if (reloadPendingRef.current) {
        reloadWhenSafe();
      } else if (activationRequestedRef.current) {
        if (!activateWaiting()) void checkForUpdate(false);
      }
    };

    const visible = () => {
      if (document.visibilityState === "visible") void checkForUpdate(true);
    };
    const online = () => void checkForUpdate(true);

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    window.addEventListener(CRITICAL_OPERATION_EVENT, criticalOperationChanged);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (effectDisposed) return;
        registeredForCleanup = registration;
        registrationRef.current = registration;
        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingRef.current = registration.waiting;
          activationSentRef.current = false;
          dispatch({ type: "WAITING" });
        }
        registration.addEventListener("updatefound", updateFound);
        dispatch({ type: "REGISTERED" });
        void checkForUpdate(true);
        return navigator.serviceWorker.ready;
      })
      .then((registration) => {
        if (!registration || effectDisposed) return;
        return attendSafeRepository.updateSettings({ offlineReady: true });
      })
      .catch(() => void checkForUpdate(true));

    const interval = window.setInterval(
      () => void checkForUpdate(true),
      PWA_UPDATE_INTERVAL_MS,
    );
    return () => {
      effectDisposed = true;
      disposedRef.current = true;
      window.clearInterval(interval);
      window.clearTimeout(activationTimerRef.current);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
      window.removeEventListener(
        CRITICAL_OPERATION_EVENT,
        criticalOperationChanged,
      );
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      registeredForCleanup?.removeEventListener("updatefound", updateFound);
      for (const [worker, listener] of watchedWorkers) {
        worker.removeEventListener("statechange", listener);
      }
    };
  }, [activateWaiting, checkForUpdate, reloadWhenSafe]);

  return {
    ...state,
    currentBuildId: CURRENT_BUILD_ID,
    promptVisible:
      !state.dismissed &&
      (state.phase === "available" ||
        state.phase === "blocked" ||
        state.phase === "activating" ||
        state.phase === "error"),
    canActivateOffline: state.waiting,
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    checkForUpdate,
    updateNow,
    updateLater,
  };
}

const EVENT_NAME = "attendsafe-critical-operation";
let activeOperations = 0;

export function beginCriticalOperation(): () => void {
  activeOperations += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { active: activeOperations > 0 } }),
    );
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeOperations = Math.max(0, activeOperations - 1);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: { active: activeOperations > 0 },
        }),
      );
    }
  };
}

export function criticalOperationActive(): boolean {
  return (
    activeOperations > 0 ||
    (typeof document !== "undefined" &&
      document.querySelector('[data-pwa-critical-operation="true"]') !== null)
  );
}

export const CRITICAL_OPERATION_EVENT = EVENT_NAME;

import { describe, expect, it } from "vitest";

import { pwaUpdateReducer } from "@/hooks/use-pwa-update";
import {
  beginCriticalOperation,
  criticalOperationActive,
} from "@/lib/pwa/critical-operation";

const idle = {
  phase: "idle" as const,
  ready: true,
  dismissed: false,
  waiting: false,
};

describe("PWA update state", () => {
  it("deduplicates worker and manifest detection into one available state", () => {
    const detected = pwaUpdateReducer(idle, {
      type: "AVAILABLE",
      buildId: "build-b",
      waiting: false,
    });
    const waiting = pwaUpdateReducer(detected, { type: "WAITING" });

    expect(waiting).toMatchObject({
      phase: "available",
      deployedBuildId: "build-b",
      waiting: true,
    });
  });

  it("dismisses Later only until the next lifecycle check", () => {
    const available = pwaUpdateReducer(idle, {
      type: "AVAILABLE",
      buildId: "build-b",
      waiting: true,
    });
    const dismissed = pwaUpdateReducer(available, { type: "DISMISS" });
    const foregrounded = pwaUpdateReducer(dismissed, {
      type: "CHECKING",
      resurface: true,
    });

    expect(dismissed.dismissed).toBe(true);
    expect(foregrounded.dismissed).toBe(false);
    expect(foregrounded.phase).toBe("available");
  });

  it("retains a detected update across offline and blocked transitions", () => {
    const available = pwaUpdateReducer(idle, {
      type: "AVAILABLE",
      buildId: "build-b",
      waiting: true,
    });
    expect(pwaUpdateReducer(available, { type: "OFFLINE" }).phase).toBe(
      "available",
    );
    expect(pwaUpdateReducer(available, { type: "BLOCKED" })).toMatchObject({
      phase: "blocked",
      deployedBuildId: "build-b",
      waiting: true,
    });
    expect(pwaUpdateReducer(available, { type: "CHECK_FAILED" }).phase).toBe(
      "available",
    );
  });
});

describe("critical-operation protection", () => {
  it("tracks nested asynchronous operations", () => {
    const endFirst = beginCriticalOperation();
    const endSecond = beginCriticalOperation();
    expect(criticalOperationActive()).toBe(true);
    endFirst();
    expect(criticalOperationActive()).toBe(true);
    endSecond();
    expect(criticalOperationActive()).toBe(false);
  });

  it("recognises an open unsaved form marker", () => {
    const form = document.createElement("form");
    form.dataset.pwaCriticalOperation = "true";
    document.body.append(form);
    expect(criticalOperationActive()).toBe(true);
    form.remove();
    expect(criticalOperationActive()).toBe(false);
  });
});

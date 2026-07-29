import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePwaUpdate } from "@/hooks/use-pwa-update";
import { CRITICAL_OPERATION_EVENT } from "@/lib/pwa/critical-operation";
import { CURRENT_BUILD_ID } from "@/lib/pwa/build-version";

vi.mock("@/db", () => ({
  attendSafeRepository: {
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

class MockWorker extends EventTarget {
  state: ServiceWorkerState = "installed";
  postMessage = vi.fn();
}

class MockRegistration extends EventTarget {
  waiting: MockWorker | null = null;
  installing: MockWorker | null = null;
  active: MockWorker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

class MockServiceWorkerContainer extends EventTarget {
  controller: object | null = {};
  ready: Promise<MockRegistration>;
  constructor(readonly registration: MockRegistration) {
    super();
    this.ready = Promise.resolve(registration);
  }
  register = vi.fn().mockImplementation(async () => this.registration);
}

function versionResponse(buildId: string = CURRENT_BUILD_ID) {
  return new Response(JSON.stringify({ buildId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("service-worker update lifecycle", () => {
  let registration: MockRegistration;
  let container: MockServiceWorkerContainer;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    registration = new MockRegistration();
    container = new MockServiceWorkerContainer(registration);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => versionResponse()),
    );
  });

  afterEach(() => {
    document
      .querySelectorAll('[data-pwa-critical-operation="true"]')
      .forEach((element) => element.remove());
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not prompt during a first installation of the current build", async () => {
    container.controller = null;
    const { result } = renderHook(() => usePwaUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(result.current.promptVisible).toBe(false);
  });

  it("detects a manifest mismatch and checks again on visibility return", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      versionResponse("deployed-build-b"),
    );
    const { result } = renderHook(() => usePwaUpdate());
    await waitFor(() => expect(result.current.promptVisible).toBe(true));

    act(() => result.current.updateLater());
    expect(result.current.promptVisible).toBe(false);
    const callsBeforeVisibility = registration.update.mock.calls.length;
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(result.current.promptVisible).toBe(true));
    expect(registration.update.mock.calls.length).toBeGreaterThan(
      callsBeforeVisibility,
    );
  });

  it("sends SKIP_WAITING once even after repeated update clicks", async () => {
    const worker = new MockWorker();
    registration.waiting = worker;
    const { result } = renderHook(() => usePwaUpdate());
    await waitFor(() => expect(result.current.promptVisible).toBe(true));

    act(() => {
      result.current.updateNow();
      result.current.updateNow();
    });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("keeps the update pending until an unsaved operation finishes", async () => {
    const worker = new MockWorker();
    registration.waiting = worker;
    const form = document.createElement("form");
    form.dataset.pwaCriticalOperation = "true";
    document.body.append(form);
    const { result } = renderHook(() => usePwaUpdate());
    await waitFor(() => expect(result.current.promptVisible).toBe(true));

    act(() => result.current.updateNow());
    expect(result.current.phase).toBe("blocked");
    expect(worker.postMessage).not.toHaveBeenCalled();

    form.remove();
    act(() =>
      window.dispatchEvent(
        new CustomEvent(CRITICAL_OPERATION_EVENT, {
          detail: { active: false },
        }),
      ),
    );
    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
  });

  it("retries silently when connectivity returns", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const { result } = renderHook(() => usePwaUpdate());
    await waitFor(() => expect(result.current.phase).toBe("offline"));
    expect(fetch).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.promptVisible).toBe(false);
  });
});

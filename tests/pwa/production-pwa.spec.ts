import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function waitForControl(page: import("@playwright/test").Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
  await page.waitForLoadState("domcontentloaded");
  // The application intentionally reloads once when a newly installed worker
  // first takes control. Wait for that lifecycle event to settle.
  await page.waitForTimeout(750);
}

async function storeCount(
  page: import("@playwright/test").Page,
  storeName: string,
) {
  return page.evaluate(
    ({ store }) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("attendsafe");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction(store, "readonly");
          const count = transaction.objectStore(store).count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
          transaction.oncomplete = () => request.result.close();
        };
      }),
    { store: storeName },
  );
}

test("real local records survive reload, offline writes, backup, worker update, and cache deletion", async ({
  context,
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-07-23T10:00:00+05:30"));
  await page.goto("/");
  await waitForControl(page);
  await expect(page.getByTestId("load-demo")).toBeVisible();
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await page.goto("/today/");
  const firstSession = page
    .getByTestId("today-session-list")
    .locator('[data-testid^="today-session-"]')
    .first();
  await firstSession
    .getByRole("button", { name: "Present", exact: true })
    .click();
  await expect.poll(() => storeCount(page, "attendanceRecords")).toBe(1);

  await page.reload();
  await expect(
    firstSession.getByRole("button", { name: "Present", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("today-page")).toBeVisible();
  await firstSession
    .getByRole("button", { name: "Absent", exact: true })
    .click();
  await expect(
    firstSession.getByRole("button", { name: "Absent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    firstSession.getByRole("button", { name: "Absent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.goto("/settings/");
  await page.getByRole("button", { name: "All profiles" }).click();
  await expect(page.getByText("JSON backup downloaded")).toBeVisible();
  await context.setOffline(false);

  await page.evaluate(async () => {
    await caches.open("attendsafe-shell-obsolete-test");
    await caches.open("unrelated-library-cache");
  });
  const updateReady = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(
      "/sw.js?retention-update=1",
      { scope: "/", updateViaCache: "none" },
    );
    const worker = registration.installing ?? registration.waiting;
    if (worker?.state !== "installed") {
      await new Promise<void>((resolve) => {
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") resolve();
        });
        window.setTimeout(resolve, 5_000);
      });
    }
    return Boolean(registration.waiting);
  });
  expect(updateReady).toBe(true);
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    }),
  ]);
  await expect.poll(() => storeCount(page, "attendanceRecords")).toBe(1);
  const postUpdateCaches = await page.evaluate(() => caches.keys());
  expect(postUpdateCaches).not.toContain("attendsafe-shell-obsolete-test");
  expect(postUpdateCaches).toContain("unrelated-library-cache");

  await page.goto("/settings/");
  await page
    .getByRole("button", { name: "Clear downloaded app files" })
    .click();
  await expect
    .poll(async () => {
      const names = await page.evaluate(() => caches.keys());
      return names.filter((name) => name.startsWith("attendsafe-")).length;
    })
    .toBe(0);
  expect(await page.evaluate(() => caches.keys())).toContain(
    "unrelated-library-cache",
  );
  expect(await storeCount(page, "profiles")).toBeGreaterThan(0);
  expect(await storeCount(page, "timetableSlots")).toBeGreaterThan(0);
  expect(await storeCount(page, "attendanceRecords")).toBe(1);
});

test("local records survive closing and reopening the application page", async ({
  context,
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-07-23T10:00:00+05:30"));
  await page.goto("/");
  await waitForControl(page);
  await page.getByTestId("load-demo").click();
  await page.goto("/today/");
  await page
    .getByTestId("today-session-list")
    .locator('[data-testid^="today-session-"]')
    .first()
    .getByRole("button", { name: "Present", exact: true })
    .click();
  await expect.poll(() => storeCount(page, "attendanceRecords")).toBe(1);

  await page.close();
  const reopenedPage = await context.newPage();
  await reopenedPage.goto("/today/");
  await expect(reopenedPage.getByTestId("today-page")).toBeVisible();
  expect(await storeCount(reopenedPage, "attendanceRecords")).toBe(1);
});

test("cache policy excludes API-like and personal content", async ({
  page,
}) => {
  await page.goto("/");
  await waitForControl(page);
  await expect(page.locator("body")).toContainText("AttendSafe");
  await page.evaluate(() => fetch("/api/synthetic-attendance"));
  const cachedUrls = await page.evaluate(async () => {
    const values: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        values.push(request.url);
      }
    }
    return values;
  });
  expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
  expect(
    cachedUrls.some((url) => /backup|attachment|blob:|data:/i.test(url)),
  ).toBe(false);
});

test("static metadata, icons, and production header policy are present", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(response?.headers()["permissions-policy"]).toContain("camera=(self)");

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const value = (await manifest.json()) as {
    display: string;
    scope: string;
    start_url: string;
    icons: Array<{ src: string }>;
  };
  expect(value).toMatchObject({
    display: "standalone",
    scope: "/",
    start_url: "/",
  });
  for (const icon of value.icons) {
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }

  const headersFile = await readFile("out/_headers", "utf8");
  expect(headersFile).toContain("Strict-Transport-Security");
  expect(headersFile).not.toMatch(/default-src\s+\*/);
  expect(headersFile).not.toContain("'unsafe-eval'");
});

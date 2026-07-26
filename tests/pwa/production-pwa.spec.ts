import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("static production output is controlled and remains usable offline", async ({
  context,
  page,
}) => {
  await page.goto("/today/");
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
  // A first install claims the page and the lifecycle component performs one
  // intentional reload. Wait for that navigation to settle before seeding IDB.
  await page.waitForTimeout(750);
  await page.waitForLoadState("domcontentloaded");

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("attendsafe-pwa-survival", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("records");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction(
            "records",
            "readwrite",
          );
          transaction.objectStore("records").put("preserved", "attendance");
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );

  const cacheNames = await page.evaluate(() => caches.keys());
  expect(
    cacheNames.some((name) => name.startsWith("attendsafe-shell-v4")),
  ).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("body")).toContainText("AttendSafe");
  await context.setOffline(false);

  const value = await page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open("attendsafe-pwa-survival");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("records", "readonly");
          const get = transaction.objectStore("records").get("attendance");
          get.onsuccess = () => resolve(get.result as string | undefined);
          get.onerror = () => reject(get.error);
        };
      }),
  );
  expect(value).toBe("preserved");
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

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const value = (await manifest.json()) as {
    display: string;
    scope: string;
    icons: Array<{ src: string }>;
  };
  expect(value).toMatchObject({ display: "standalone", scope: "/" });
  for (const icon of value.icons) {
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }

  const headersFile = await readFile("out/_headers", "utf8");
  expect(headersFile).toContain("Strict-Transport-Security");
  expect(headersFile).not.toMatch(/default-src\s+\*/);
  expect(headersFile).not.toContain("'unsafe-eval'");
});

import { expect, test, type Page } from "@playwright/test";

async function resetAndLoadDemo(page: Page) {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear();
        const request = indexedDB.deleteDatabase("attendsafe");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("Test database reset blocked"));
      }),
  );
  await page.reload();
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();
}

test("@installation mobile Chromium handles deferred prompt and installed state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await resetAndLoadDemo(page);
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: async () => undefined },
      userChoice: {
        value: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    });
    window.dispatchEvent(event);
  });
  await page
    .getByTestId("settings-page")
    .getByRole("button", { name: "Install App", exact: true })
    .click();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByText("App installed").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /All profiles/ }),
  ).toBeVisible();
});

test("@installation mobile WebKit shows accessible Safari instructions and retains data", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-webkit");
  await resetAndLoadDemo(page);
  await page.getByRole("button", { name: "Install using Safari" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Install on iPhone or iPad",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Share button/)).toBeVisible();
  await expect(dialog.getByText(/Add to Home Screen/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /All profiles/ }),
  ).toBeVisible();
});

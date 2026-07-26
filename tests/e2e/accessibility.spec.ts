import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function resetAndLoadDemo(page: Page) {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear();
        sessionStorage.clear();
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
}

test("@accessibility core local-data pages have no serious Axe violations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await resetAndLoadDemo(page);
  for (const route of ["/dashboard", "/today", "/timetable", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((item) =>
      new Set(["serious", "critical"]).has(item.impact ?? ""),
    );
    expect(
      blocking,
      `${route}: ${blocking.map((item) => item.id).join(", ")}`,
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("@accessibility install instructions trap and restore keyboard focus", async ({
  page,
}) => {
  await resetAndLoadDemo(page);
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: "View installation steps" });
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Install AttendSafe" });
  await expect(dialog).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

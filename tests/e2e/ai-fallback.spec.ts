import { expect, test } from "@playwright/test";

const FIXED_NOW = new Date("2026-07-23T10:00:00+05:30");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("attendsafe");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
  );
  await page.reload();
});

test("AI fallback requires consent and opens the existing editable review", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/timetable/analyse", async (route) => {
    requests += 1;
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toContain("multipart/form-data");
    if (requests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
        body: JSON.stringify({
          ok: false,
          error: {
            code: "AI_PROVIDER_UNAVAILABLE",
            message: "AI schedule analysis is temporarily unavailable.",
            retryable: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        ok: true,
        data: {
          document: {
            institution: null,
            department: null,
            programme: null,
            semester: "AI Review Semester",
            section: null,
            room: null,
            academicYear: null,
          },
          timeSlots: [
            { startTime: "11:00", endTime: "12:00", sourceText: null },
          ],
          subjects: [
            {
              code: "AI501",
              name: "AI Extracted Class",
              facultyCodes: [],
              facultyNames: [],
              room: null,
            },
          ],
          sessions: [
            {
              day: "Thursday",
              startTime: "11:00",
              endTime: "12:00",
              subjectCode: "AI501",
              subjectName: "AI Extracted Class",
              facultyCodes: [],
              facultyNames: [],
              room: null,
              type: "lecture",
              batchTags: [],
              electiveTags: [],
              sectionTags: [],
              sourceText: "THU AI501",
              confidence: 0.95,
              notes: null,
            },
          ],
          warnings: ["AI fixture: review before saving."],
        },
      }),
    });
  });

  await page.getByTestId("choose-upload").click();
  const profile = page.getByTestId("profile-setup-form");
  await profile.getByLabel("Display name").fill("AI Fallback Student");
  await profile.getByLabel("Semester name").fill("AI Semester");
  await profile.getByLabel("Starts", { exact: true }).fill("2026-07-01");
  await profile.getByLabel("Ends", { exact: true }).fill("2026-12-15");
  await profile.getByRole("button", { name: /Continue to timetable/ }).click();
  await page.getByLabel("Choose timetable image or PDF").setInputFiles({
    name: "unreadable.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kWQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByTestId("extract-timetable").click();
  await expect(page.getByTestId("use-ai-timetable")).toBeVisible();
  await page.getByTestId("use-ai-timetable").click();
  await expect(
    page.getByRole("dialog", { name: "Use AI to read this schedule?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(requests).toBe(0);

  await page.getByTestId("use-ai-timetable").click();
  await page.getByRole("button", { name: "Continue with AI" }).click();
  await expect(
    page.getByText(
      "Gemini is temporarily busy. Please wait a moment and try again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try AI again" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Enter timetable manually" }),
  ).toBeEnabled();
  expect(requests).toBe(1);

  await page.getByRole("button", { name: "Try AI again" }).click();
  await page.getByRole("button", { name: "Continue with AI" }).click();
  await expect(
    page.getByText(
      "AI-assisted extraction. Check the classes below before continuing.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(requests).toBe(2);

  await page.getByRole("button", { name: "Review schedule" }).click();
  await expect(page.getByText("AI Extracted Class").first()).toBeVisible();
  await expect(page.getByTestId("weekly-grid-corner")).toHaveText("Day / Time");
  const aiClass = page.getByRole("button", {
    name: "AI501, Thursday, 11:00 AM to 12:00 PM",
  });
  await expect(aiClass).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("attendsafe");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const count = database
              .transaction("timetableSlots", "readonly")
              .objectStore("timetableSlots")
              .count();
            count.onsuccess = () => {
              database.close();
              resolve(count.result);
            };
            count.onerror = () => reject(count.error);
          };
        }),
    ),
  ).toBe(0);
  await aiClass.click();
  const editDialog = page.getByRole("dialog", { name: "Edit class" });
  await editDialog.getByLabel("Subject name").fill("Reviewed AI Class");
  await editDialog.getByTestId("save-slot").click();
  await expect(page.getByText("Reviewed AI Class").first()).toBeVisible();
  await page.getByTestId("confirm-timetable").click();
  await expect(page).toHaveURL(/\/today\/?$/);
  await expect(page.getByText("Reviewed AI Class")).toBeVisible();
});

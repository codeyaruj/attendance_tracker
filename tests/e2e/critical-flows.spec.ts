import { expect, test, type Page } from "@playwright/test";

const DATABASE_NAME = "attendsafe";
const FIXED_NOW = new Date("2026-07-23T10:00:00+05:30");

type StoredRecord = Record<string, unknown>;

// The suite-level override also makes the spec usable with an already-running app.
test.use({ baseURL: "http://localhost:3000" });

async function resetLocalData(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ databaseName }) =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear();
        sessionStorage.clear();
        const request = indexedDB.deleteDatabase(databaseName);
        request.addEventListener("success", () => resolve());
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB reset failed.")),
        );
        request.addEventListener("blocked", () =>
          reject(
            new Error("IndexedDB reset was blocked by an open connection."),
          ),
        );
      }),
    { databaseName: DATABASE_NAME },
  );
  await page.reload();
  await expect(page.getByTestId("choose-manual")).toBeVisible();
}

async function readStore(
  page: Page,
  storeName: string,
): Promise<StoredRecord[]> {
  return page.evaluate(
    async ({ databaseName, requestedStore }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB could not be opened.")),
        );
      });
      try {
        return await new Promise<StoredRecord[]>((resolve, reject) => {
          const transaction = database.transaction(requestedStore, "readonly");
          const request = transaction.objectStore(requestedStore).getAll();
          request.addEventListener("success", () =>
            resolve(request.result as StoredRecord[]),
          );
          request.addEventListener("error", () =>
            reject(
              request.error ?? new Error(`Could not read ${requestedStore}.`),
            ),
          );
        });
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, requestedStore: storeName },
  );
}

async function loadDemo(page: Page): Promise<void> {
  await page.getByTestId("load-demo").click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
}

async function openTodayWithDemo(page: Page): Promise<void> {
  await loadDemo(page);
  await page.goto("/today");
  await expect(page.getByTestId("today-page")).toBeVisible();
  await expect(page.getByTestId("today-session-list")).toBeVisible();
}

function todaySessionCards(page: Page) {
  return page
    .getByTestId("today-session-list")
    .locator('[data-testid^="today-session-"]');
}

async function markFirstClassPresent(page: Page): Promise<void> {
  const firstCard = todaySessionCards(page).first();
  await expect(firstCard).toBeVisible();
  await firstCard.getByRole("button", { name: "Present", exact: true }).click();
  await expect(
    firstCard.getByRole("button", { name: "Present", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await readStore(page, "attendanceRecords")).length)
    .toBe(1);
}

async function completeProfileSetup(
  page: Page,
  displayName = "E2E Student",
): Promise<void> {
  const profileForm = page.getByTestId("profile-setup-form");
  await profileForm.getByLabel("Display name").fill(displayName);
  await profileForm.getByLabel("Institution (optional)").fill("Test Institute");
  await profileForm.getByLabel("Semester name").fill("Automation Semester");
  await profileForm.getByLabel("Starts", { exact: true }).fill("2026-07-01");
  await profileForm.getByLabel("Ends", { exact: true }).fill("2026-12-15");
  await profileForm
    .getByRole("button", { name: /Continue to timetable/ })
    .click();
}

async function advanceTimetableConfirmation(page: Page): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    if (await page.getByTestId("confirm-timetable").isVisible()) return;
    await page.getByRole("button", { name: /^Continue/ }).click();
  }
  throw new Error("Timetable confirmation review was not reached.");
}

async function expectControlReceivesPointerEvents(
  page: Page,
  testId: string,
): Promise<void> {
  const control = page.getByTestId(testId);
  await expect(control).toBeInViewport();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || Boolean(hit && element.contains(hit));
      }),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await resetLocalData(page);
});

test("manual timetable creation supports attendance marking and dashboard review", async ({
  page,
}) => {
  await page.getByTestId("choose-manual").click();
  await completeProfileSetup(page);

  await expect(
    page.getByRole("heading", { name: "Build it your way" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paste timetable" }).click();
  const pasteDialog = page.getByRole("dialog", {
    name: "Paste timetable text",
  });
  await pasteDialog
    .getByRole("textbox")
    .fill(
      [
        "Monday 09:00-10:00 MAT501 Engineering Mathematics",
        "Tuesday 09:00-10:00 PHY501 Applied Physics",
        "Wednesday 09:00-10:00 CSE501 Programming Fundamentals",
        "Thursday 09:00-10:00 ECE501 Circuit Theory",
        "Friday 09:00-10:00 HSM501 Professional Ethics",
      ].join("\n"),
    );
  await pasteDialog.getByRole("button", { name: "Parse & review" }).click();
  await expect(page.getByText(/5 classes parsed/)).toBeVisible();
  await page.getByTestId("review-manual-timetable").click();

  await advanceTimetableConfirmation(page);
  await expectControlReceivesPointerEvents(page, "confirm-timetable");
  await page.getByTestId("confirm-timetable").click();

  await expect(page).toHaveURL(/\/today\/?$/);
  await expect(page.getByTestId("today-page")).toBeVisible();
  await markFirstClassPresent(page);
  await page.goto("/dashboard");
  const subjectCard = page
    .getByTestId("subject-card-list")
    .locator('[data-testid^="subject-card-"]')
    .filter({ hasText: "ECE501" });
  await expect(subjectCard).toContainText("100%");
  await expect
    .poll(async () => (await readStore(page, "profiles")).length)
    .toBe(1);
  await expect
    .poll(async () => (await readStore(page, "timetableSlots")).length)
    .toBe(5);
  const profiles = await readStore(page, "profiles");
  expect(profiles[0]?.displayName).toBe("E2E Student");
});

test("timetable upload can skip local OCR and continue to manual review", async ({
  page,
}) => {
  await page.getByTestId("choose-upload").click();
  await completeProfileSetup(page, "Upload Student");
  await page.getByLabel("Choose timetable image or PDF").setInputFiles({
    name: "timetable.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2kWQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByAltText("Uploaded timetable preview")).toBeVisible();
  await page
    .getByRole("button", { name: /Skip OCR and enter it myself/ })
    .click();

  await advanceTimetableConfirmation(page);
  await page.getByTestId("add-class").click();
  const subjectForm = page.getByTestId("add-subject-form");
  await subjectForm.getByLabel("Subject name").fill("Uploaded Schedule Class");
  await subjectForm.getByLabel("Subject code").fill("UPL501");
  await subjectForm.getByText("Mon", { exact: true }).click();
  await subjectForm.getByText("Thu", { exact: true }).click();
  await subjectForm.getByLabel("Starts").fill("11:00");
  await subjectForm.getByLabel("Ends").fill("12:00");
  await subjectForm.getByTestId("preview-subject").click();
  await page.getByTestId("confirm-add-subject").click();
  await expectControlReceivesPointerEvents(page, "confirm-timetable");
  await page.getByTestId("confirm-timetable").click();

  await expect(page).toHaveURL(/\/today\/?$/);
  await expect(
    page.getByTestId("today-session-list").getByText("Uploaded Schedule Class"),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await readStore(page, "uploadedTimetableReferences")).length,
    )
    .toBe(1);
});

test("demo setup supports batch and elective selection", async ({ page }) => {
  await loadDemo(page);

  await expect(page.getByTestId("summary-tracked")).not.toContainText("0");
  await expect(page.getByTestId("subject-card-list")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();
  const scheduleSettings = page.locator("#schedule-rules");
  await scheduleSettings.getByLabel("Selected batch").selectOption("B");
  await expect(page.getByText("Batch B selected")).toBeVisible();
  await scheduleSettings.getByLabel("Optical Communication").click();
  await expect(page.getByText("Elective I selection saved")).toBeVisible();

  await expect
    .poll(async () => (await readStore(page, "subjects")).length)
    .toBeGreaterThan(0);
  const profiles = await readStore(page, "profiles");
  expect(profiles[0]?.displayName).toBe("Demo student");
  const settings = await readStore(page, "appSettings");
  expect(settings[0]?.selectedBatch).toBe("B");
  const electiveGroups = await readStore(page, "electiveGroups");
  const electiveOne = electiveGroups.find(
    (group) => group.name === "Elective I",
  );
  const opticalOption = (
    (electiveOne?.options ?? []) as Array<{
      label: string;
      subjectId: string;
    }>
  ).find((option) => option.label === "Optical Communication");
  expect(opticalOption).toBeDefined();
  expect(electiveOne?.selectedSubjectIds as string[]).toContain(
    opticalOption?.subjectId,
  );
});

test("demo mode exits to setup without deleting demo data", async ({
  page,
}) => {
  await loadDemo(page);
  await page.goto("/");
  await expect(page.getByTestId("choose-manual")).toBeVisible();
  expect((await readStore(page, "profiles")).length).toBe(1);
  await page.goto("/dashboard");
  await expect(page.getByText("You are exploring demo data.")).toBeVisible();
  await page.getByTestId("exit-demo").first().click();
  const dialog = page.getByRole("dialog", { name: "Exit demo" });
  await expect(dialog).toContainText("demo data will stay");
  await dialog.getByRole("button", { name: "Start fresh setup" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("choose-manual")).toBeVisible();
  expect((await readStore(page, "profiles")).length).toBe(1);
  expect((await readStore(page, "semesters")).length).toBe(1);
  expect((await readStore(page, "timetableSlots")).length).toBeGreaterThan(0);
});

test("demo exit can continue directly into real profile setup", async ({
  page,
}) => {
  await loadDemo(page);
  await page.goto("/settings");
  const profileSection = page.locator("#profile-semester");
  await expect(profileSection.getByText("Demo profile")).toBeVisible();
  await profileSection.getByTestId("exit-demo").click();
  await page
    .getByRole("dialog", { name: "Exit demo" })
    .getByRole("button", { name: "Create a real profile" })
    .click();

  await expect(page.getByTestId("profile-setup-form")).toBeVisible();
  expect((await readStore(page, "profiles")).length).toBe(1);
  const settings = await readStore(page, "appSettings");
  expect(settings[0]?.activeProfileId).toBeUndefined();
  expect(settings[0]?.activeSemesterId).toBeUndefined();
});

test("a single attendance mark can be undone", async ({ page }) => {
  await openTodayWithDemo(page);
  await markFirstClassPresent(page);

  const recent = page.getByTestId("recent-actions");
  await expect(recent).toBeVisible();
  await recent
    .getByRole("button", { name: "Undo", exact: true })
    .first()
    .click();
  await expect(page.getByText("Change undone")).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "attendanceRecords")).length)
    .toBe(0);
});

test("bulk day attendance requires confirmation and updates every class", async ({
  page,
}) => {
  await openTodayWithDemo(page);
  const classCount = await todaySessionCards(page).count();
  expect(classCount).toBeGreaterThan(1);

  await page.getByRole("button", { name: "All absent", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Mark every class absent?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("confirm-action").click();
  await expect(page.getByText("Attendance updated")).toBeVisible();

  await expect
    .poll(async () => (await readStore(page, "attendanceRecords")).length)
    .toBe(classCount);
  const records = await readStore(page, "attendanceRecords");
  expect(records.every((record) => record.status === "ABSENT")).toBe(true);
});

test("marking a college holiday creates a dated academic exception", async ({
  page,
}) => {
  await openTodayWithDemo(page);
  await page.getByRole("button", { name: "Holiday", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Mark today as a college holiday?",
  });
  await dialog.getByTestId("confirm-action").click();
  await expect(page.getByText("College holiday saved")).toBeVisible();

  await expect
    .poll(async () => {
      const exceptions = await readStore(page, "academicExceptions");
      return exceptions.some(
        (exception) =>
          exception.type === "HOLIDAY" &&
          exception.startDate === "2026-07-23" &&
          exception.endDate === "2026-07-23",
      );
    })
    .toBe(true);
  await expect(
    page.getByText(/College holiday — this class does not count/).first(),
  ).toBeVisible();
});

test("extra and cancelled classes are dated exceptions that preserve attendance", async ({
  page,
}) => {
  await openTodayWithDemo(page);
  await markFirstClassPresent(page);

  await page.getByTestId("add-session-change").click();
  let changeForm = page.getByTestId("session-change-form");
  await changeForm.getByLabel("Starts").fill("18:00");
  await changeForm.getByLabel("Ends").fill("19:00");
  await changeForm.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText("Extra class added")).toBeVisible();

  await page.getByTestId("add-session-change").click();
  changeForm = page.getByTestId("session-change-form");
  await changeForm.getByLabel("Change type").selectOption("CANCELLATION");
  await changeForm.getByRole("button", { name: "Cancel class" }).click();
  await expect(page.getByText("Class cancelled")).toBeVisible();

  const exceptions = await readStore(page, "academicExceptions");
  expect(exceptions.some((item) => item.type === "EXTRA_SESSION")).toBe(true);
  expect(exceptions.some((item) => item.type === "CANCELLED_SESSION")).toBe(
    true,
  );
  expect(await readStore(page, "attendanceRecords")).toHaveLength(1);
});

test("a timetable edit is activated as a new version", async ({ page }) => {
  await loadDemo(page);
  await page.goto("/timetable");
  await expect(page.getByTestId("timetable-screen")).toBeVisible();
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page
    .getByTestId(/^timetable-slot-/)
    .first()
    .click();
  await page.getByRole("button", { name: "Edit this class" }).click();

  const versionDialog = page.getByRole("dialog", {
    name: "Edit timetable",
  });
  await versionDialog.getByLabel("Version label").fill("E2E room update");

  const slotForm = page.getByTestId("slot-form");
  await expect(slotForm).toBeVisible();
  await slotForm.getByLabel("Room", { exact: true }).fill("E2E-101");
  await slotForm.getByTestId("save-slot").click();
  await versionDialog
    .getByRole("button", { name: "Confirm & activate" })
    .click();

  await expect(page.getByText("Timetable version 2 activated")).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "timetableVersions")).length)
    .toBe(2);
  const versions = await readStore(page, "timetableVersions");
  const newest = versions.find((version) => version.version === 2);
  const slots = await readStore(page, "timetableSlots");
  expect(
    slots.some(
      (slot) =>
        slot.timetableVersionId === newest?.id && slot.room === "E2E-101",
    ),
  ).toBe(true);
});

test("the skip planner simulates and saves a full-day absence only after confirmation", async ({
  page,
}) => {
  await loadDemo(page);
  await page.goto("/skip-planner");
  await expect(
    page.getByRole("heading", {
      name: "Plan upcoming absences",
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^(Whole day|Day)$/ }).click();
  await page.getByLabel("Date", { exact: true }).fill("2026-07-24");
  await expect(page.getByTestId("planner-projection")).toBeVisible();
  expect(await readStore(page, "attendanceRecords")).toHaveLength(0);

  await page.getByTestId("plan-absences").click();
  const dialog = page.getByRole("dialog", {
    name: /Plan \d+ absences\?/,
  });
  await expect(dialog).toBeVisible();
  expect(await readStore(page, "attendanceRecords")).toHaveLength(0);
  await dialog.getByTestId("confirm-planned-absences").click();

  await expect(page.getByText(/\d+ planned absences saved/)).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "attendanceRecords")).length)
    .toBeGreaterThan(1);
  const records = await readStore(page, "attendanceRecords");
  expect(records.every((record) => record.status === "ABSENT")).toBe(true);
});

test("a JSON backup can be exported, reset, and re-imported", async ({
  page,
}, testInfo) => {
  await loadDemo(page);
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Active profile", exact: true })
    .click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("attendsafe-backup.json");
  await download.saveAs(backupPath);

  await page
    .getByRole("button", { name: "Reset entire app", exact: true })
    .click();
  const resetDialog = page.getByRole("dialog", {
    name: "Reset the entire app?",
  });
  await resetDialog
    .getByTestId("destructive-confirmation-input")
    .fill("RESET APP");
  await resetDialog.getByTestId("destructive-confirmation-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("choose-manual")).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "profiles")).length)
    .toBe(0);

  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page
    .getByLabel("Choose AttendSafe JSON backup")
    .setInputFiles(backupPath);
  await expect(page.getByTestId("backup-import-preview")).toBeVisible();
  await page.getByLabel(/Type "REPLACE"/).fill("REPLACE");
  await page.getByTestId("confirm-backup-import").click();
  await expect(
    page.getByText(/Imported .* subjects and .* attendance records/),
  ).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "profiles")).length)
    .toBe(1);

  await page.goto("/dashboard");
  await expect(page.getByTestId("subject-card-list")).toBeVisible();
});

test("backup import previews and transactionally replaces local data", async ({
  page,
}, testInfo) => {
  await loadDemo(page);
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "All profiles" }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath("preview-backup.json");
  await download.saveAs(backupPath);

  await page
    .getByLabel("Choose AttendSafe JSON backup")
    .setInputFiles(backupPath);
  await expect(page.getByTestId("backup-import-preview")).toBeVisible();
  await expect(page.getByText(/No backup data is uploaded/)).toBeVisible();
  await page.getByLabel(/Type "REPLACE"/).fill("REPLACE");
  await page.getByTestId("confirm-backup-import").click();
  await expect(
    page.getByText(/Imported .* subjects and .* attendance records/),
  ).toBeVisible();
  await expect(page.getByTestId("backup-import-preview")).toBeHidden();
  await expect
    .poll(async () => (await readStore(page, "profiles")).length)
    .toBe(1);
});

test("a previous attendance record can be corrected from history", async ({
  page,
}) => {
  await openTodayWithDemo(page);
  await markFirstClassPresent(page);
  await page.goto("/history");
  await expect(page.getByTestId("history-page")).toBeVisible();

  const historyEntry = page
    .getByTestId("history-entry-list")
    .locator('[data-testid^="history-entry-"]')
    .first();
  await historyEntry.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit attendance" });
  await editDialog.getByTestId("edit-attendance-status").selectOption("ABSENT");
  await editDialog.getByLabel("Note").fill("Corrected after roll call");
  await editDialog.getByTestId("save-history-edit").click();

  await expect(page.getByText("Attendance correction saved")).toBeVisible();
  await expect(historyEntry).toContainText("Absent");
  await expect
    .poll(async () => {
      const records = await readStore(page, "attendanceRecords");
      return records[0]?.status;
    })
    .toBe("ABSENT");
});

test("changing the semester threshold recalculates dashboard risk", async ({
  page,
}) => {
  await loadDemo(page);
  const dspCard = page
    .getByTestId("subject-card-list")
    .locator('[data-testid^="subject-card-"]')
    .filter({
      has: page.getByRole("heading", {
        name: "Digital Signal Processing",
        exact: true,
      }),
    });
  await expect(dspCard).toContainText("Safe");
  await expect(dspCard).toContainText("70%");

  await page.goto("/settings");
  const semesterSettings = page.locator("#profile-semester");
  await semesterSettings.getByLabel("Minimum required (%)").fill("75");
  await semesterSettings.getByLabel("Safety target (%)").fill("80");
  await semesterSettings
    .getByRole("button", { name: "Save semester", exact: true })
    .click();
  await expect(page.getByText("Semester guardrails saved")).toBeVisible();

  await page.goto("/dashboard");
  const recalculatedCard = page
    .getByTestId("subject-card-list")
    .locator('[data-testid^="subject-card-"]')
    .filter({
      has: page.getByRole("heading", {
        name: "Digital Signal Processing",
        exact: true,
      }),
    });
  await expect(recalculatedCard).toContainText("Below minimum");
  await expect(recalculatedCard).toContainText("75%");
  const semesters = await readStore(page, "semesters");
  expect(semesters[0]?.minimumAttendanceBasisPoints).toBe(7500);
  expect(semesters[0]?.safetyTargetBasisPoints).toBe(8000);
});

test("reset attendance stays locked behind its typed confirmation", async ({
  page,
}) => {
  await openTodayWithDemo(page);
  await markFirstClassPresent(page);
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();

  await page
    .getByRole("button", { name: "Reset attendance", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reset this semester's attendance?",
  });
  const submit = dialog.getByTestId("destructive-confirmation-submit");
  await expect(submit).toBeDisabled();
  await dialog
    .getByTestId("destructive-confirmation-input")
    .fill("RESET ATTENDANCE");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText("Semester attendance reset")).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "attendanceRecords")).length)
    .toBe(0);
});

test("@responsive primary pages fit narrow viewports and expose touch-friendly controls", async ({
  page,
}) => {
  await loadDemo(page);
  const routes = [
    "/today/",
    "/dashboard/",
    "/timetable/",
    "/skip-planner/",
    "/history/",
    "/settings/",
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>("*"))
        .map((element) => ({
          tag: element.tagName,
          classes: element.className,
          right: Math.round(element.getBoundingClientRect().right),
        }))
        .filter((item) => item.right > window.innerWidth + 1)
        .slice(0, 8),
    }));
    expect(
      overflow.documentWidth,
      `${route} overflow diagnostics: ${JSON.stringify(overflow)}`,
    ).toBeLessThanOrEqual(overflow.viewport);
  }

  await page.goto("/today/");
  const present = page
    .getByRole("button", { name: "Present", exact: true })
    .first();
  const bounds = await present.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await expect(
      page.getByRole("navigation", { name: "Bottom navigation" }),
    ).toBeVisible();
  }

  await page.goto("/timetable/");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Timetable agenda" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Weekly timetable" }),
  ).toBeVisible();

  await page.goto("/settings/");
  await expect(page.getByText("Storage on this device")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Protect local data" }),
  ).toBeVisible();
});

test("@responsive timetable upload offers camera and existing-file choices", async ({
  page,
}) => {
  await page.getByTestId("choose-upload").click();
  await completeProfileSetup(page, "Mobile Upload Student");
  await expect(
    page.locator("button").filter({ hasText: "Take timetable photo" }),
  ).toBeVisible();
  await expect(
    page.locator("button").filter({ hasText: "Choose image or PDF" }),
  ).toBeVisible();
  await expect(page.getByLabel("Take timetable photo")).toHaveAttribute(
    "capture",
    "environment",
  );
  await expect(
    page.getByLabel("Choose timetable image or PDF"),
  ).not.toHaveAttribute("capture");
});

import { expect, test, type Locator, type Page } from "@playwright/test";

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
  const presentButton = firstCard.getByRole("button", {
    name: "Present",
    exact: true,
  });
  await expect(presentButton).toBeVisible();
  await expect(presentButton).toBeEnabled();
  await scrollControlIntoSafeView(presentButton);
  await expectLocatorReceivesPointerEvents(presentButton);
  await presentButton.click();
  await expect(presentButton).toHaveAttribute("aria-pressed", "true");
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
  await expect(
    page.getByRole("heading", { name: "Which classes belong to you?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review schedule" }).click();
  await expect(page.getByTestId("confirm-timetable")).toBeVisible();
}

async function openWideTimetableSelection(page: Page): Promise<void> {
  await page.getByTestId("choose-manual").click();
  await completeProfileSetup(page, "Responsive Layout Student");
  await page.getByRole("button", { name: "Paste timetable" }).click();
  const pasteDialog = page.getByRole("dialog", {
    name: "Paste timetable text",
  });
  await pasteDialog
    .getByRole("textbox")
    .fill(
      [
        "Monday 07:00-08:00 SUB701 Applied Mathematics",
        "Tuesday 08:00-09:00 SUB702 Applied Physics",
        "Wednesday 09:00-10:00 SUB703 Programming Fundamentals",
        "Thursday 10:00-11:00 SUB704 Circuit Theory",
        "Friday 11:00-12:00 SUB705 Professional Ethics",
        "Monday 12:00-13:00 SUB706 Digital Electronics",
        "Tuesday 13:00-14:00 SUB707 Signal Processing",
        "Wednesday 14:00-15:00 SUB708 Control Systems",
        "Thursday 15:00-16:00 SUB709 Communication Systems",
        "Friday 16:00-17:00 SUB710 Embedded Systems",
        "Monday 17:00-18:00 SUB711 Computer Networks",
        "Tuesday 18:00-19:00 SUB712 Engineering Design",
      ].join("\n"),
    );
  await pasteDialog.getByRole("button", { name: "Parse & review" }).click();
  await expect(page.getByText(/12 classes parsed/)).toBeVisible();
  await page.getByTestId("review-manual-timetable").click();
  await expect(
    page.getByRole("heading", { name: "Which classes belong to you?" }),
  ).toBeVisible();
}

async function expectNoDocumentHorizontalOverflow(
  page: Page,
  context: string,
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rectangle = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          classes: element.className,
          left: Math.round(rectangle.left),
          right: Math.round(rectangle.right),
        };
      })
      .filter(
        (item) =>
          item.left < -1 ||
          item.right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8),
  }));
  expect(
    overflow.scrollWidth,
    `${context} overflow diagnostics: ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function scrollControlIntoSafeView(control: Locator): Promise<void> {
  await control.evaluate((element) => {
    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
  });
}

async function expectLocatorReceivesPointerEvents(
  control: Locator,
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toBeInViewport();
  try {
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
  } catch (cause) {
    const diagnostics = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const describe = (candidate: Element | null) =>
        candidate
          ? {
              tag: candidate.tagName.toLowerCase(),
              className: candidate.getAttribute("class"),
              ariaLabel: candidate.getAttribute("aria-label"),
              text: candidate.textContent?.trim().slice(0, 160) ?? "",
            }
          : null;
      return {
        target: {
          ...describe(element),
          disabled:
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement
              ? element.disabled
              : element.getAttribute("aria-disabled"),
          rectangle: {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
        },
        hit: describe(document.elementFromPoint(point.x, point.y)),
        elementsFromPoint: document
          .elementsFromPoint(point.x, point.y)
          .slice(0, 8)
          .map(describe),
      };
    });
    throw new Error(
      `Control did not receive pointer events. Diagnostics: ${JSON.stringify(diagnostics)}`,
      { cause },
    );
  }
}

async function expectControlReceivesPointerEvents(
  page: Page,
  testId: string,
): Promise<void> {
  await expectLocatorReceivesPointerEvents(page.getByTestId(testId));
}

type InAppNavigationLabel =
  "Today" | "Dashboard" | "Timetable" | "Skip" | "Settings";

async function navigateInApp(
  page: Page,
  label: InAppNavigationLabel,
): Promise<void> {
  const desktopLabel = label === "Skip" ? "Skip Planner" : label;
  const desktopLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: desktopLabel, exact: true });
  const mobileLink = page
    .getByRole("navigation", { name: "Bottom navigation" })
    .getByRole("link", { name: label, exact: true });

  if (await desktopLink.isVisible().catch(() => false)) {
    await desktopLink.click();
    return;
  }

  await expect(mobileLink).toBeVisible();
  const coveredByDevelopmentOverlay = await mobileLink.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return document
      .elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      .some((candidate) => candidate.tagName.toLowerCase() === "nextjs-portal");
  });
  if (coveredByDevelopmentOverlay) {
    const menuButton = page.getByRole("button", { name: "Open menu" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const menuLink = page
      .getByRole("navigation", { name: "Mobile menu" })
      .getByRole("link", { name: desktopLabel, exact: true });
    await expect(menuLink).toBeVisible();
    await menuLink.click();
    return;
  }
  await mobileLink.click();
}

async function dispatchDeferredInstallPrompt(page: Page): Promise<void> {
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
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await resetLocalData(page);
});

test("manual timetable creation supports attendance marking and dashboard review", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  await dispatchDeferredInstallPrompt(page);
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
  await expect(page.getByLabel("Application notice")).toHaveCount(0);
  await expectControlReceivesPointerEvents(page, "confirm-timetable");
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __onboardingNoticeTracker?: {
        appeared: boolean;
        observer: MutationObserver;
      };
    };
    const observer = new MutationObserver(() => {
      if (
        window.location.pathname === "/" &&
        document.querySelector('[aria-label="Application notice"]')
      ) {
        testWindow.__onboardingNoticeTracker!.appeared = true;
      }
    });
    testWindow.__onboardingNoticeTracker = { appeared: false, observer };
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId("confirm-timetable").click();

  await expect(page).toHaveURL(/\/today\/?$/);
  await expect(page.getByTestId("today-page")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __onboardingNoticeTracker?: {
          appeared: boolean;
          observer: MutationObserver;
        };
      };
      const appeared = testWindow.__onboardingNoticeTracker?.appeared ?? false;
      testWindow.__onboardingNoticeTracker?.observer.disconnect();
      delete testWindow.__onboardingNoticeTracker;
      return appeared;
    }),
  ).toBe(false);
  if (mobile) {
    expect(await page.evaluate(() => window.innerWidth)).toBeLessThan(1024);
    await expect(page.getByLabel("Application notice")).toHaveCount(0);
  } else {
    await expect(page.getByLabel("Application notice")).toBeVisible();
  }
  await navigateInApp(page, "Settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();
  const installButton = page
    .getByTestId("settings-page")
    .getByRole("button", { name: "Install App", exact: true });
  await expect(installButton).toBeVisible();
  await expect(installButton).toBeEnabled();
  await navigateInApp(page, "Today");
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

  await expect(
    page.getByRole("heading", { name: "Build it your way" }),
  ).toBeVisible();
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
  await page.getByTestId("review-manual-timetable").click();
  await advanceTimetableConfirmation(page);
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
    await expectNoDocumentHorizontalOverflow(page, route);
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

  await page.goto("/settings/");
  const labs = page.getByRole("checkbox", { name: /Labs/ });
  await page.getByText("Labs", { exact: true }).click();
  await expect(labs).toBeChecked();
  await expect
    .poll(async () => {
      const settings = await readStore(page, "appSettings");
      return (settings[0]?.trackedClassTypes as Record<string, boolean>)?.LAB;
    })
    .toBe(true);

  await page.goto("/timetable/");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Timetable agenda" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Weekly timetable" }),
  ).toBeVisible();
  await expect(page.getByTestId("weekly-grid-corner")).toHaveText("Day / Time");
  await expect(page.getByTestId("weekly-grid-day-monday")).toBeVisible();
  const timeHeaders = page
    .getByRole("region", { name: "Weekly timetable" })
    .getByRole("columnheader");
  await expect(timeHeaders.nth(1)).toContainText(/AM|PM/);

  const labButton = page.getByRole("button", {
    name: /DSP Lab, Thursday, 2:00 PM to 4:00 PM, A/,
  });
  const lab = page.getByTestId(
    "timetable-slot-00000000-0000-4000-8000-000000000223",
  );
  await expect(lab).toHaveCSS("grid-column-end", "span 2");
  const weeklyScroll = page.getByTestId("weekly-timetable-scroll");
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    expect(
      await weeklyScroll.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByTestId("weekly-grid-day-monday")).toHaveCSS(
    "position",
    "sticky",
  );
  await labButton.click();
  await expect(
    page.getByRole("dialog", { name: "Digital Signal Processing Lab" }),
  ).toBeVisible();

  await page.goto("/settings/");
  await expect(page.getByText("Storage on this device")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Protect local data" }),
  ).toBeVisible();
});

test("onboarding selection and review contain wide schedules at supported viewport sizes", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The viewport matrix runs once with Chromium.",
  );
  const viewportSizes = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1536, height: 1024 },
  ];

  for (const viewport of viewportSizes) {
    await page.setViewportSize(viewport);
    await resetLocalData(page);
    await openWideTimetableSelection(page);
    const context = `${viewport.width}x${viewport.height}`;

    await expectNoDocumentHorizontalOverflow(page, `${context} selection`);
    await expect(page.getByTestId("compact-schedule-summary")).toBeVisible();
    await expect(page.getByTestId("weekly-timetable-grid")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Back", exact: true }),
    ).toHaveCount(1);

    const selectionItems = page.getByTestId("class-selection-item");
    const selectionItemCount = await selectionItems.count();
    expect(selectionItemCount).toBeGreaterThan(0);
    const finalSelectionItem = selectionItems.nth(selectionItemCount - 1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const actionBar = page.getByTestId("timetable-confirmation-actions");
    const [finalItemBounds, actionBarBounds] = await Promise.all([
      finalSelectionItem.boundingBox(),
      actionBar.boundingBox(),
    ]);
    expect(finalItemBounds).not.toBeNull();
    expect(actionBarBounds).not.toBeNull();
    expect(finalItemBounds!.y + finalItemBounds!.height).toBeLessThanOrEqual(
      actionBarBounds!.y + 1,
    );

    const reviewButton = page.getByRole("button", {
      name: "Review schedule",
    });
    await scrollControlIntoSafeView(reviewButton);
    await expectLocatorReceivesPointerEvents(reviewButton);
    const fullScheduleButton = page.getByRole("button", {
      name: "View full schedule",
    });
    await scrollControlIntoSafeView(fullScheduleButton);
    await expectLocatorReceivesPointerEvents(fullScheduleButton);
    await fullScheduleButton.click();

    await expect(page.getByTestId("compact-schedule-summary")).toHaveCount(0);
    await expect(page.getByTestId("weekly-timetable-grid")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page, `${context} review`);
    const weeklyScroll = page.getByTestId("weekly-timetable-scroll");
    expect(
      await weeklyScroll.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
      `${context} review grid should scroll internally`,
    ).toBe(true);
  }
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

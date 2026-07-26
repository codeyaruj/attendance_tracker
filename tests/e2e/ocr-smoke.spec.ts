import { expect, test } from "@playwright/test";
import sharp from "sharp";

test.use({ baseURL: "http://localhost:3000" });

test("real local OCR reaches table-aware review in Chromium", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One real OCR run is sufficient; mobile behavior is covered without repeating the expensive worker job.",
  );
  test.setTimeout(120_000);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="400">
      <rect width="900" height="400" fill="white"/>
      <g stroke="black" stroke-width="5">
        <path d="M40 80H860M40 200H860M40 320H860"/>
        <path d="M40 80V320M260 80V320M580 80V320M860 80V320"/>
      </g>
      <g fill="black" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
        <text x="420" y="150">09:00 - 10:00</text>
        <text x="150" y="275">MONDAY</text>
        <text x="420" y="275">BEC501</text>
      </g>
    </svg>
  `);
  const png = await sharp(svg).png().toBuffer();

  await page.goto("/");
  await page.getByTestId("choose-upload").click();
  const profile = page.getByTestId("profile-setup-form");
  await profile.getByLabel("Display name").fill("OCR Smoke Student");
  await profile.getByLabel("Semester name").fill("OCR Smoke Semester");
  await profile.getByLabel("Starts", { exact: true }).fill("2026-07-01");
  await profile.getByLabel("Ends", { exact: true }).fill("2026-12-15");
  await profile.getByRole("button", { name: /Continue to timetable/ }).click();
  await page.getByLabel("Choose timetable image or PDF").setInputFiles({
    name: "synthetic-grid.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByTestId("extract-timetable").click();

  await expect(page.getByTestId("extraction-preview")).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/detected cells/).first()).toBeVisible();
  await expect(page.getByText(/BEC501/).first()).toBeVisible();
});

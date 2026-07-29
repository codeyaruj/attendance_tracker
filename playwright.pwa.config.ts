import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pwa",
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/serve-static.mjs out 4173",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

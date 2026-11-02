import { defineConfig, devices } from "@playwright/test";

// Points both servers at the local emulators instead of the shared project.
const EMULATOR_ENV = {
  REACT_APP_USE_EMULATORS: "true",
  REACT_APP_FIREBASE_PROJECT_ID: "demo-connectsphere",
  REACT_APP_FIREBASE_API_KEY: "fake-api-key",
  REACT_APP_FIREBASE_AUTH_DOMAIN: "localhost",
  BROWSER: "none"
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on",
    video: "retain-on-failure",
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start:backend",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: EMULATOR_ENV
    },
    {
      command: "npm run start:frontend",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 180_000,
      env: EMULATOR_ENV
    }
  ]
});
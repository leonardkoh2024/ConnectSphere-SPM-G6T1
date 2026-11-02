// Starts the backend and frontend against the local emulators, the same way
// playwright.config.js does for the e2e tests. Run through `npm run manual:start`,
// which sets FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// These win over the values in .env (dotenv-cli does not override variables already set),
// so neither the browser nor the backend can reach the shared Firebase project.
const env = {
  ...process.env,
  REACT_APP_USE_EMULATORS: "true",
  REACT_APP_FIREBASE_PROJECT_ID: "demo-connectsphere",
  REACT_APP_FIREBASE_API_KEY: "fake-api-key",
  REACT_APP_FIREBASE_AUTH_DOMAIN: "localhost",
  GCLOUD_PROJECT: "demo-connectsphere",
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"
};

console.log("\nStarting ConnectSphere on http://localhost:3000 against the local emulators.\n");
const child = spawn("npm start", { stdio: "inherit", shell: true, cwd: root, env });
child.on("exit", (code) => process.exit(code ?? 0));

// `npm run manual:start` — starts the Firebase emulators (Auth + Firestore), loads the
// manual-test baseline into them, then starts the backend (:4000) and frontend (:3000)
// pointed at the emulators. Ctrl+C stops everything; the emulator data is thrown away.
//
// To reset to the baseline between test cases without restarting, run
// `npm run manual:seed` in a second terminal.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = "node manual-tests/seed-baseline.mjs && node manual-tests/start-app.mjs";
const command = `npx firebase emulators:exec --only auth,firestore --project demo-connectsphere "${script}"`;

const result = spawnSync(command, { stdio: "inherit", shell: true, cwd: root });
process.exit(result.status == null ? 1 : result.status);

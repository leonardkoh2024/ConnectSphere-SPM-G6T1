// Forwards arguments into Playwright inside the Firebase emulators.
// A bare story id selects that story: `npm run e2e -- B9`.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const extra = process.argv.slice(2);
const story = extra.find((arg) => /^[A-L]\d+$/.test(arg));
const rest = extra.filter((arg) => arg !== story);
const quote = (arg) => (/[\s|]/.test(arg) ? `"${arg.replace(/"/g, "")}"` : arg);
const grep = story ? ` --grep \\[${story}\\]` : "";
const script = `npx playwright test${grep}${rest.length ? ` ${rest.map(quote).join(" ")}` : ""}`;

const command = `npx firebase emulators:exec --only auth,firestore --project demo-connectsphere "${script}"`;
const result = spawnSync(command, {
  stdio: "inherit",
  shell: true,
  cwd: path.join(__dirname, "..")
});

process.exit(result.status == null ? 1 : result.status);

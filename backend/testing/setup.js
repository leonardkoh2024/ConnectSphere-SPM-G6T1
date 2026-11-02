// Setup and teardown shared by every backend unit test. The test scripts load this
// with `node --test --import ./testing/setup.js`, so these hooks wrap every test in
// every *.test.js file, ahead of any hooks a test file declares itself.
// (Named setup.js, not *.test.js, so `node --test` does not run it as a test file.)
//
// Unit tests build their data fresh with fakeFirestore(), so there is no database
// to reset here — only process-wide state a test could change and forget to undo.

import { beforeEach, afterEach, mock } from "node:test";

let savedEnv;

// Setup — remember the environment as it is before the test runs.
beforeEach(() => {
  savedEnv = { ...process.env };
});

// Teardown — put back anything a test mocked or changed, even if it failed midway.
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

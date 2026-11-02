// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Setup and teardown shared by every frontend test. Create React App runs this
// file before each test file, so these hooks wrap every test in the suite, ahead
// of any beforeEach/afterEach a test file declares itself. Mocks need nothing
// here: react-scripts already resets every jest.fn() before each test.

// What fetch was before any test replaced it (undefined under jsdom).
const realFetch = global.fetch;

// Setup — every test starts on no screen, with nothing remembered in storage.
beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  sessionStorage.clear();
});

// Teardown — undo what a test may have swapped out, even if it failed midway.
afterEach(() => {
  if (realFetch) global.fetch = realFetch;
  else delete global.fetch;
  jest.useRealTimers();
});

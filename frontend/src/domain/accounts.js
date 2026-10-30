// Account rules: what counts as a valid password and mobile number.
//
// Pure functions, no React and no Firebase — these are the rules themselves, so
// they are cheap to unit test and can move into `backend/` unchanged.

// Firebase's minimum is lower, so enforce ConnectSphere's stronger rule in the
// client before an account is ever sent to Firebase Authentication.
//
// One list, read twice: the registration form ticks each rule off live as the
// password is typed, and isStrongPassword requires all of them on submit — so the
// checklist can never promise something the submit check then refuses.
export const PASSWORD_RULES = [
  { id: "length", label: "At least 12 characters", test: (password) => password.length >= 12 },
  { id: "number", label: "One number", test: (password) => /\d/.test(password) },
  { id: "special", label: "One special character", test: (password) => /[^A-Za-z0-9]/.test(password) }
];

export function passwordChecks(password) {
  const value = String(password ?? "");
  return PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, met: test(value) }));
}

export function isStrongPassword(password) {
  return passwordChecks(password).every((check) => check.met);
}

export function isValidMobileNumber(number) {
  return /^\d{7,15}$/.test(String(number));
}

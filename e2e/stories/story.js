// Backlog ID → Jira key, taken from the commit history (`B9; SCRUM-100; …`).
// Each spec titles its describe block with `story("B9")`, so a run can be filtered
// by either ID: `npm run e2e -- B9` or `--grep @SCRUM-100`.
const JIRA = {
  A1: 82, A2: 83, A3: 84, A4: 90, A5: 91, A6: 169, A7: 170,
  B1: 92, B2: 93, B3: 94, B4: 95, B5: 96, B6: 97, B7: 98, B8: 99, B9: 100, B10: 101,
  C1: 102, C2: 103, C3: 104, C4: 105, C5: 106, C6: 107, C7: 108, C8: 109, C9: 110,
  D1: 111, D2: 112, D3: 113, D4: 114, D5: 115, D6: 116,
  E1: 117, E2: 118, E3: 119, E4: 120, E5: 121, E6: 122, E7: 123, E8: 124, E9: 171, E10: 172, E11: 173,
  F1: 125, F2: 126, F3: 127, F4: 128, F5: 129, F6: 130, F7: 131, F8: 132,
  F9: 174, F10: 175, F11: 176, F12: 177, F13: 178, F14: 179, F15: 180, F16: 181,
  G1: 133, G2: 134, G3: 135, G4: 136, G5: 137, G6: 138,
  H1: 139, H2: 140, H3: 141, H4: 142, H5: 143, H6: 144, H7: 145, H8: 146,
  I1: 147, I2: 148, I3: 149,
  J1: 150, J2: 151, J3: 152, J4: 153, J5: 154, J6: 155, J7: 156, J8: 191, J9: 192,
  K1: 182, K2: 183, K3: 184, K4: 185, K5: 186,
  L1: 187, L2: 188, L3: 189, L4: 190
};

// `test.describe(...story("B9", "Submit an event request"), () => { … })`
export const story = (id, summary) => [`[${id}] ${summary}`, { tag: [`@${id}`, `@SCRUM-${JIRA[id]}`] }];

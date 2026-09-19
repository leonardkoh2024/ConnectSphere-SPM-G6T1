// TC-073, TC-074, TC-075 — the rotation rule itself, in isolation from Firestore
// and the backend transaction that calls it.

import { pickNextCoordinator } from "./coordinatorAssignment";

const C1 = { id: "c1", coordinator_seq: 1 };
const C2 = { id: "c2", coordinator_seq: 2 };
const C3 = { id: "c3", coordinator_seq: 3 };

describe("TC-073 consecutive picks rotate in ascending coordinator_seq", () => {
  test("no prior assignment starts at the lowest seq", () => {
    expect(pickNextCoordinator([C1, C2, C3], null)).toEqual(C1);
  });

  test("each subsequent pick moves to the next higher seq", () => {
    expect(pickNextCoordinator([C1, C2, C3], 1)).toEqual(C2);
    expect(pickNextCoordinator([C1, C2, C3], 2)).toEqual(C3);
  });

  test("input order does not matter — sorted by coordinator_seq", () => {
    expect(pickNextCoordinator([C3, C1, C2], 1)).toEqual(C2);
  });
});

describe("TC-074 rotation wraps after the last coordinator back to the first", () => {
  test("last-assigned seq is the highest seeded — wraps to the lowest", () => {
    expect(pickNextCoordinator([C1, C2, C3], 3)).toEqual(C1);
  });

  test("last-assigned seq is higher than every seeded seq — still wraps to the lowest", () => {
    expect(pickNextCoordinator([C1, C2, C3], 99)).toEqual(C1);
  });
});

describe("TC-075 a single seeded coordinator receives every event", () => {
  test.each([null, 1, 1, 1])("stays on the only coordinator", (lastAssignedSeq) => {
    expect(pickNextCoordinator([C1], lastAssignedSeq)).toEqual(C1);
  });
});

describe("guards", () => {
  test("throws rather than silently returning nothing when no coordinator is seeded", () => {
    expect(() => pickNextCoordinator([], null)).toThrow();
  });
});

// Functional tests for the venue service's HTTP routes (E3/E11, F5, F10, F16): each request goes
// through a real Express app built by createVenueService over an in-memory Firestore.
import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { createVenueService } from "./index.js";

const storeFirestore = (seed = {}, { failOn } = {}) => {
  const store = { ...seed };
  let generated = 0;
  const guard = (name) => { if (failOn && failOn === name) throw new Error(`firestore ${name} unavailable`); };
  const snapshotOf = (path) => ({ id: path.split("/")[1], ref: { path }, exists: store[path] !== undefined, data: () => store[path] });
  const docRef = (name, id) => ({ kind: "doc", name, path: `${name}/${id}`, id, get: async () => { guard(name); return snapshotOf(`${name}/${id}`); } });
  const run = (target) => {
    guard(target.name);
    return target.kind !== "query" ? snapshotOf(target.path) : {
      docs: Object.keys(store)
        .filter((path) => path.startsWith(`${target.name}/`) && target.filters.every(([field, value]) => store[path][field] === value))
        .map(snapshotOf)
    };
  };
  const queryRef = (name, filters = []) => ({
    kind: "query", name, filters,
    where: (field, _operator, value) => queryRef(name, [...filters, [field, value]]),
    get: async () => run(queryRef(name, filters))
  });
  return {
    store,
    collection: (name) => ({
      doc: (id) => docRef(name, id ?? `generated-${++generated}`),
      where: (field, operator, value) => queryRef(name).where(field, operator, value),
      get: async () => run(queryRef(name))
    }),
    runTransaction: async (operation) => {
      const writes = [];
      const result = await operation({
        get: async (target) => run(target),
        set: (target, data) => writes.push(() => { store[target.path] = data; }),
        update: (target, data) => writes.push(() => { store[target.path] = { ...store[target.path], ...data }; }),
        delete: (target) => writes.push(() => { delete store[target.path]; })
      });
      writes.forEach((write) => write());
      return result;
    }
  };
};

const seed = (extra = {}) => ({
  "users/staff-1": { role: "VENUE_STAFF" },
  "users/staff-2": { role: "VENUE_STAFF" },
  "users/coord-1": { role: "EVENT_COORDINATOR" },
  "users/org-1": { role: "EVENT_ORGANISER" },
  "venues/V1": { name: "Main Hall" },
  "venue_staff/V1": { venue_id: "V1", user_id: "staff-1" },
  ...extra
});

const harness = async (firestore, { parseJson = true, tokens = { "t-staff": "staff-1", "t-staff2": "staff-2", "t-coord": "coord-1", "t-org": "org-1", "t-ghost": "ghost" } } = {}) => {
  const app = express();
  if (parseJson) app.use(express.json());
  app.use("/api/venues", createVenueService({
    firestore,
    verifyIdToken: async (token) => {
      if (!tokens[token]) throw new Error("bad token");
      return { uid: tokens[token] };
    },
    serverTimestamp: () => "STAMP"
  }));
  // Mirrors backend/src/index.js: an unhandled error becomes a JSON 500.
  app.use((_error, _request, response, _next) => response.status(500).json({ error: "Internal server error" }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/venues${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, url: (path) => `http://127.0.0.1:${server.address().port}/api/venues${path}`, close: () => new Promise((resolve) => server.close(resolve)) };
};

const withServer = async (firestore, callback) => {
  const server = await harness(firestore);
  try { await callback(server.call); } finally { await server.close(); }
};

const period = (changes = {}) => ({ start_datetime: "2026-11-10T01:00:00.000Z", end_datetime: "2026-11-10T03:00:00.000Z", reason: "Repairs", ...changes });

test("TC-0042 [failure] A4 venue routes refuse a missing, malformed or invalid token and an unknown profile", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    assert.deepEqual(await call("POST", "/workflows/refresh"), { status: 401, body: { error: "Sign in is required." } });
    assert.deepEqual(await call("POST", "/V1/recheck-conflicts", { token: "unknown" }), {
      status: 401, body: { error: "Your sign-in session is invalid or expired." }
    });
    assert.deepEqual(await call("PUT", "/unavailability", { token: "t-ghost", body: {} }), {
      status: 403, body: { error: "Your user profile could not be found." }
    });
  });
});

test("TC-0043 [conflict] A4 only Venue Staff manage unavailability, clash checks and rejections", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    for (const [method, path] of [["PUT", "/unavailability"], ["POST", "/V1/recheck-conflicts"], ["POST", "/bookings/B1/reject"]]) {
      const response = await call(method, path, { token: "t-coord", body: { reason: "x" } });
      assert.equal(response.status, 403, path);
      assert.equal(response.body.error, "Only Venue Staff can manage venue operations.");
    }
  });
});

test("TC-0587 [failure] the auth lookup failing becomes a 500 on every venue route", async () => {
  await withServer(storeFirestore(seed(), { failOn: "users" }), async (call) => {
    for (const [method, path] of [["POST", "/workflows/refresh"], ["PUT", "/unavailability"], ["POST", "/V1/recheck-conflicts"], ["POST", "/bookings/B1/reject"]]) {
      assert.deepEqual(await call(method, path, { token: "t-staff", body: {} }), { status: 500, body: { error: "Internal server error" } }, path);
    }
  });
});

test("TC-1147 [normal] F16/F10 Venue Staff refresh expires due holds and counts clashes", async () => {
  const firestore = storeFirestore(seed({
    "venue_bookings/H1": { status: "HELD", venue_id: "V1", hold_expires_at: new Date("2020-01-01T00:00:00Z") }
  }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/workflows/refresh", { token: "t-staff" }), {
      status: 200, body: { holds_processed: 1, venues_checked: 1, active_conflicts: 0 }
    });
    assert.equal(firestore.store["venue_bookings/H1"].status, "EXPIRED");
  });
});

test("TC-0588 [failure] a refresh whose workflow pass fails is a 500", async () => {
  await withServer(storeFirestore(seed(), { failOn: "venue_bookings" }), async (call) => {
    assert.equal((await call("POST", "/workflows/refresh", { token: "t-staff" })).status, 500);
  });
});

test("TC-0589 [failure] E3 unavailability needs a venue id and two lists", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    const bad = (body) => call("PUT", "/unavailability", { token: "t-staff", body });
    assert.deepEqual(await bad({ keep_period_ids: [], additions: [] }), { status: 400, body: { error: "venue_id is required." } });
    assert.deepEqual(await bad({ venue_id: "   ", keep_period_ids: [], additions: [] }), { status: 400, body: { error: "venue_id is required." } });
    assert.deepEqual(await bad({ venue_id: "V1", keep_period_ids: "p1", additions: [] }), { status: 400, body: { error: "keep_period_ids and additions must be lists." } });
    assert.deepEqual(await bad({ venue_id: "V1", keep_period_ids: [] }), { status: 400, body: { error: "keep_period_ids and additions must be lists." } });
    assert.deepEqual(await bad({ venue_id: "V1", keep_period_ids: [], additions: [period({ reason: " " })] }), { status: 400, body: { error: "A reason is required." } });
  });
});

test("TC-0044 [failure] A4 a non-Bearer authorization header counts as signed out", async () => {
  const server = await harness(storeFirestore(seed()));
  try {
    const response = await fetch(server.url("/V1/recheck-conflicts"), { method: "POST", headers: { Authorization: "Basic t-staff" } });
    assert.equal(response.status, 401);
  } finally { await server.close(); }
});

test("TC-0590 [boundary] E3 the router mounted without a JSON body parser treats the body as empty", async () => {
  const server = await harness(storeFirestore(seed()), { parseJson: false });
  try {
    assert.deepEqual(await server.call("PUT", "/unavailability", { token: "t-staff" }), { status: 400, body: { error: "venue_id is required." } });
  } finally { await server.close(); }
});

test("TC-0591 [normal] E3 saving unavailability returns kept and new periods with ISO dates", async () => {
  const firestore = storeFirestore(seed({
    "venue_unavailability/ts": { venue_id: "V1", reason: "Timestamp", start_datetime: { toDate: () => new Date("2026-11-01T00:00:00Z") }, end_datetime: { toDate: () => new Date("2026-11-01T01:00:00Z") } },
    "venue_unavailability/text": { venue_id: "V1", reason: "Text", start_datetime: "2026-11-02 09:00", end_datetime: "2026-11-02 10:00" },
    "venue_unavailability/blank": { venue_id: "V1", reason: "Undated" }
  }));
  await withServer(firestore, async (call) => {
    const response = await call("PUT", "/unavailability", {
      token: "t-staff", body: { venue_id: " V1 ", keep_period_ids: ["ts", "text", "blank"], additions: [period({ note: "bring keys" })] }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.periods, [
      { id: "ts", venue_id: "V1", start_datetime: "2026-11-01T00:00:00.000Z", end_datetime: "2026-11-01T01:00:00.000Z", reason: "Timestamp" },
      { id: "text", venue_id: "V1", start_datetime: "2026-11-02 09:00", end_datetime: "2026-11-02 10:00", reason: "Text" },
      { id: "blank", venue_id: "V1", reason: "Undated" },
      { id: "generated-1", venue_id: "V1", start_datetime: "2026-11-10T01:00:00.000Z", end_datetime: "2026-11-10T03:00:00.000Z", reason: "Repairs" }
    ]);
  });
});

test("TC-0841 [conflict] E11 a period over an approved booking needs confirmation, then flags the booking", async () => {
  const firestore = storeFirestore(seed({
    "venue_bookings/B1": { venue_id: "V1", status: "APPROVED", event_id: "E1", reference_no: "BK-1", start_datetime: "2026-11-10T02:00:00Z", end_datetime: "2026-11-10T04:00:00Z" },
    "events/E1": { coordinator_id: "coord-1", status: "CONFIRMED" }
  }));
  await withServer(firestore, async (call) => {
    const body = { venue_id: "V1", keep_period_ids: [], additions: [period()] };
    assert.deepEqual(await call("PUT", "/unavailability", { token: "t-staff", body }), {
      status: 409,
      body: { error: "Confirm the affected bookings before taking this venue out of use.", confirmation_required: true, affected: [{ booking_id: "B1", label: "BK-1", event_id: "E1" }] }
    });
    // confirm_overlaps must be exactly true.
    assert.equal((await call("PUT", "/unavailability", { token: "t-staff", body: { ...body, confirm_overlaps: "yes" } })).status, 409);
    assert.equal((await call("PUT", "/unavailability", { token: "t-staff", body: { ...body, confirm_overlaps: true } })).status, 200);
    assert.equal(firestore.store["venue_bookings/B1"].status, "APPROVED");
    assert.equal(firestore.store["venue_bookings/B1"].replacement_needed, true);
    assert.equal(firestore.store["events/E1"].status, "PLANNING");
  });
});

test("TC-0592 [conflict] E3 unknown venue, unassigned staff and stale period ids are refused", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    const put = (token, body) => call("PUT", "/unavailability", { token, body: { keep_period_ids: [], additions: [], ...body } });
    assert.deepEqual(await put("t-staff", { venue_id: "V9" }), { status: 404, body: { error: "Venue V9 was not found." } });
    assert.deepEqual(await put("t-staff2", { venue_id: "V1" }), { status: 403, body: { error: "You are not assigned to manage this venue." } });
    assert.deepEqual(await put("t-staff", { venue_id: "V1", keep_period_ids: ["gone"] }), { status: 409, body: { error: "Unavailability period gone was not found." } });
  });
});

test("TC-0593 [failure] E3 a Firestore failure while saving unavailability is a 500", async () => {
  const firestore = storeFirestore(seed());
  firestore.runTransaction = async () => { throw new Error("deadline exceeded"); };
  await withServer(firestore, async (call) => {
    assert.equal((await call("PUT", "/unavailability", { token: "t-staff", body: { venue_id: "V1", keep_period_ids: [], additions: [] } })).status, 500);
  });
});

test("TC-0995 [normal] F10 assigned Venue Staff recheck one venue's clashes", async () => {
  const firestore = storeFirestore(seed({
    "venue_bookings/B1": { venue_id: "V1", status: "APPROVED", start_datetime: "2099-01-01T01:00:00Z", end_datetime: "2099-01-01T03:00:00Z" },
    "venue_bookings/B2": { venue_id: "V1", status: "APPROVED", start_datetime: "2099-01-01T02:00:00Z", end_datetime: "2099-01-01T04:00:00Z" }
  }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/V1/recheck-conflicts", { token: "t-staff" }), { status: 200, body: { active_conflicts: 1 } });
  });
});

test("TC-0996 [conflict] F10 clash recheck refuses an unknown venue, an unassigned member and a failing store", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    assert.deepEqual(await call("POST", "/V9/recheck-conflicts", { token: "t-staff" }), { status: 404, body: { error: "Venue not found." } });
    assert.deepEqual(await call("POST", "/V1/recheck-conflicts", { token: "t-staff2" }), { status: 403, body: { error: "You are not assigned to manage this venue." } });
  });
  await withServer(storeFirestore(seed(), { failOn: "venue_bookings" }), async (call) => {
    assert.equal((await call("POST", "/V1/recheck-conflicts", { token: "t-staff" })).status, 500);
  });
});

test("TC-0937 [failure] F5 rejecting a booking that does not exist is a 404", async () => {
  await withServer(storeFirestore(seed()), async (call) => {
    assert.deepEqual(await call("POST", "/bookings/missing/reject", { token: "t-staff", body: { reason: "No" } }), {
      status: 404, body: { error: "Booking request not found." }
    });
    assert.deepEqual(await call("POST", "/bookings/missing/reject", { token: "t-staff", body: { reason: 42 } }), {
      status: 400, body: { error: "A rejection reason is required." }
    });
  });
});

test("TC-0938 [boundary] F5 a held booking with no requester is rejected without a notice", async () => {
  const firestore = storeFirestore(seed({ "venue_bookings/B1": { venue_id: "V1", event_id: "E1", status: "HELD" } }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/bookings/B1/reject", { token: "t-staff", body: { reason: " Too small " } }), {
      status: 200, body: { booking_id: "B1", status: "REJECTED", decision_reason: "Too small" }
    });
    assert.equal(firestore.store["venue_bookings/B1"].requires_re_request, true);
    assert.equal(Object.keys(firestore.store).some((path) => path.startsWith("notifications/")), false);
    assert.equal(Object.keys(firestore.store).filter((path) => path.startsWith("event_history/")).length, 1);
  });
});

test("TC-0939 [boundary] F5 the rejection notice names the venue by id when it has no catalogue name, and 'Your event' when unnamed", async () => {
  const firestore = storeFirestore(seed({
    "venues/V2": {},
    "venue_staff/V2": { venue_id: "V2", user_id: "staff-1" },
    "venue_bookings/B1": { venue_id: "V2", event_id: "E1", status: "PENDING", requested_by: "coord-1" },
    "venue_staff/V3": { venue_id: "V3", user_id: "staff-1" },
    "venue_bookings/B2": { venue_id: "V3", event_id: "E2", status: "PENDING", requested_by: "coord-1", event_name: "Gala" }
  }));
  await withServer(firestore, async (call) => {
    assert.equal((await call("POST", "/bookings/B1/reject", { token: "t-staff", body: { reason: "Closed" } })).status, 200);
    assert.equal((await call("POST", "/bookings/B2/reject", { token: "t-staff", body: { reason: "Closed" } })).status, 200);
    const messages = Object.keys(firestore.store).filter((path) => path.startsWith("notifications/")).map((path) => firestore.store[path]);
    assert.deepEqual(messages.map((notice) => notice.message), [
      "Your event: the booking for V2 was rejected. Reason: Closed",
      "Gala: the booking for V3 was rejected. Reason: Closed"
    ]);
    assert.deepEqual(messages.map((notice) => notice.event_name), ["", "Gala"]);
  });
});

test("TC-0940 [conflict] F5 a booking whose assignment points at another venue cannot be rejected", async () => {
  const firestore = storeFirestore(seed({
    "venue_staff/V4": { venue_id: "V1", user_id: "staff-1" },
    "venue_bookings/B1": { venue_id: "V4", status: "PENDING" }
  }));
  await withServer(firestore, async (call) => {
    assert.deepEqual(await call("POST", "/bookings/B1/reject", { token: "t-staff", body: { reason: "No" } }), {
      status: 403, body: { error: "You are not assigned to manage this venue." }
    });
    assert.equal(firestore.store["venue_bookings/B1"].status, "PENDING");
  });
});

test("TC-0941 [failure] F5 a Firestore failure during rejection is a 500 and nothing is written", async () => {
  const firestore = storeFirestore(seed({ "venue_bookings/B1": { venue_id: "V1", status: "PENDING" } }), { failOn: "venue_staff" });
  await withServer(firestore, async (call) => {
    assert.equal((await call("POST", "/bookings/B1/reject", { token: "t-staff", body: { reason: "No" } })).status, 500);
    assert.equal(firestore.store["venue_bookings/B1"].status, "PENDING");
  });
});

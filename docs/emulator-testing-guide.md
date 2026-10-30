# Firestore emulator testing — team guide

So anyone on the team can run and write integration tests against the Firestore emulator.
Covers **macOS and Windows**.

Companion files:
- `firestoreEmulator.js` — shared harness → put at `backend/testing/firestoreEmulator.js`
- `service.integration.TEMPLATE.js` — template for a new integration test → keep in `docs/`, copy from it

---

## 1. What the emulator is, and why we use it

The Firestore **emulator** is a real Firestore database that runs **on your own laptop**
instead of in the cloud. Same protocol as cloud Firestore and — importantly — the same
**transaction behaviour** (two `runTransaction` calls hitting the same document at once, one
retries so they don't clobber each other).

Two levels of test:

| Level | Runs against | Proves | Needs |
|---|---|---|---|
| **Unit** (`*.test.js`) | an in-memory fake | the rules/logic | nothing (`node --test`) |
| **Integration** (`*.integration.js`) | the **emulator** | real Firestore behaviour under concurrency, `serverTimestamp`, batched writes | Java + firebase-tools |

The emulator is in-memory, needs **no credentials**, and is thrown away when it stops — so
integration tests **never touch the shared team project**. The harness also refuses to run
unless it's pointed at an emulator.

## 2. When to write an integration test (and when not to)

- **Write one** if the service uses `runTransaction`, batched writes, `serverTimestamp`, or its
  correctness depends on **concurrency, ordering, or uniqueness** (e.g. C1 assignment; likely
  C9 reassignment, venue bookings).
- **Don't bother** for pure domain rules — the in-memory unit test next to the domain
  module already covers those.
- **Rules testing** (proving `firestore.rules` allow/deny the right client writes)
  uses the same emulator but the `@firebase/rules-unit-testing` library.

## 3. Naming matters (avoids a real footgun)

`node --test` with no path auto-discovers **every** `*.test.js` file and runs it. An integration
test needs the emulator, so if you name it `*.integration.test.js` it gets swept into the normal
unit run and **fails** (its safety guard throws with no emulator).

**Rule: name integration tests `*.integration.js`** (no `.test`), and run them only via
`emulators:exec` (section 6). Keep the harness in `backend/testing/`, not `backend/test/` —
`node --test` also auto-scans folders literally named `test`.

## 4. One-time setup

### 4a. Node deps (all platforms)
`firebase-admin` is already in `backend/package.json`. Add the tooling once:
`npm install -D firebase-tools` (or just use `npx firebase ...`).

### 4b. Java (the emulator is a Java program)
Check: `java -version`. If it prints **11 or newer**, done. Otherwise install a JDK:

**macOS** — `brew install --cask temurin`, or download the Temurin LTS **.pkg** from
https://adoptium.net (Apple Silicon for M-series, x64 for Intel). Then a **new** terminal → `java -version`.

**Windows** — `winget install EclipseAdoptium.Temurin.21.JDK`, or the Temurin LTS **.msi** from
https://adoptium.net (tick **Set JAVA_HOME** and **Add to PATH** in the installer). Then a
**new** terminal → `java -version`.

Any JDK 11+ works (we've run on Temurin 27); versions don't need to match across the team.

## 5. Project layout

```
backend/
  testing/firestoreEmulator.js            <- shared harness (NOT a folder named "test")
  src/services/<name>/
    <name>.js                             <- service: takes `firestore` as an injected argument
    <name>.test.js                        <- unit test (in-memory fake)
    <name>.integration.js                 <- emulator test (uses the harness)
docs/
  service.integration.TEMPLATE.js         <- copy this to start a new integration test
  emulator-testing-guide.md               <- this file
```

The rule that makes this reusable: **write services that take `firestore` (and
`serverTimestamp`) as arguments** — e.g. `createYourService({ firestore, serverTimestamp })`.
Then the unit test passes a fake and the integration test passes the real emulator db, no change
to the service.

## 6. Running an integration test (from the repo root)

`emulators:exec` starts the emulator, runs the command, shuts it down, and sets
`FIRESTORE_EMULATOR_HOST` for you.

**macOS / Linux:**
```bash
npx firebase emulators:exec --only firestore --project demo-connectsphere \
  "node --test backend/src/services/<yourService>/<yourService>.integration.js"
```

**Windows (one line — `\` doesn't continue lines in PowerShell/cmd):**
```powershell
npx firebase emulators:exec --only firestore --project demo-connectsphere "node --test backend/src/services/<yourService>/<yourService>.integration.js"
```

Run all integration tests at once, each starting from the same baseline (`backend/testing/fixtures.js`): `npm run test:integration`.

### Watch the data (optional)
`npx firebase emulators:start --only firestore --project demo-connectsphere`, then open the
**Emulator UI at http://localhost:4000** → Firestore tab, and run the test in another terminal
with `FIRESTORE_EMULATOR_HOST=localhost:8080` set (PowerShell: `$env:FIRESTORE_EMULATOR_HOST="localhost:8080"`).

## 7. Writing a new integration test

1. Copy `docs/service.integration.TEMPLATE.js` → `backend/src/services/<yourService>/<yourService>.integration.js`.
2. Fill the three TODOs: import the real service, list collections to wipe, then seed / exercise /
   assert by re-reading Firestore.
3. Run with the section-6 command. A new test is usually ~20 lines thanks to the harness.

No Firestore schema is needed — Firestore is schemaless, the emulator starts empty. Each test
just seeds the document shape its service reads.

## 8. Troubleshooting

- **"Unable to locate a Java Runtime"** — install Java (4b), open a new terminal.
- **`MODULE_TYPELESS_PACKAGE_JSON` warning** — harmless; do NOT add `"type":"module"` to
  `frontend/package.json` (CRA app, breaks react-scripts).
- **"Refusing to run: FIRESTORE_EMULATOR_HOST is not set"** — the safety guard; run via
  `emulators:exec` (section 6), don't run the file directly.
- **A unit run (`node --test`) fails on an integration test** — it's named `*.test.js`; rename it
  to `*.integration.js` (section 3).
- **Port 8080/4000 in use** — a previous emulator is still running; stop it or change ports in `firebase.json`.
- **Emulator jar download fails** — first run fetches ~137 MB from Google; a network/VPN that
  blocks `storage.googleapis.com` will fail.

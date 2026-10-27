// An in-memory Firestore stand-in for the registration service's unit tests (H3, H5).
// (Folder is "testing", not "test", so `node --test` does not run this as a test file.)
//
// It answers equality `where` chains, `get`, `count` and single documents, inside or outside
// a transaction. Reads are recorded in `log.reads`; a transaction's writes are applied only
// when its callback returns, so a refusal leaves `store` and `log.writes` untouched.

import assert from "node:assert/strict";

export const fakeFirestore = (collections) => {
  const store = Object.fromEntries(Object.entries(collections).map(([name, docs]) => [name, { ...docs }]));
  const log = { reads: [], writes: [], transactions: 0 };
  const read = (target) => {
    log.reads.push(target.kind === "doc" ? target.path : `${target.name}?${target.filters.map(([f, v]) => `${f}=${v}`).join("&")}`);
    if (target.kind === "doc") {
      const data = store[target.name]?.[target.id];
      return { id: target.id, exists: Boolean(data), data: () => data };
    }
    const docs = Object.entries(store[target.name] || {})
      .filter(([, data]) => target.filters.every(([field, value]) => data[field] === value))
      .map(([id, data]) => ({ id, data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const docRef = (name, id) => {
    const target = { kind: "doc", name, id, path: `${name}/${id}` };
    return { ...target, get: async () => read(target) };
  };
  const query = (name, filters = []) => {
    const target = { kind: "query", name, filters };
    return {
      ...target,
      where(field, op, value) {
        assert.equal(op, "==");
        return query(name, [...filters, [field, value]]);
      },
      get: async () => read(target),
      count: () => ({ get: async () => ({ data: () => ({ count: read(target).size }) }) })
    };
  };
  return {
    log,
    store,
    collection: (name) => ({ doc: (id) => docRef(name, id), where: (field, op, value) => query(name).where(field, op, value) }),
    async runTransaction(callback) {
      log.transactions += 1;
      const pending = [];
      let wrote = false;
      const transaction = {
        async get(target) {
          assert.equal(wrote, false, "Firestore transactions must read before they write.");
          return read(target);
        },
        set(target, data) { wrote = true; pending.push([target, data, "set"]); },
        update(target, data) {
          wrote = true;
          assert.ok(store[target.name]?.[target.id], `update of a missing document ${target.path}`);
          pending.push([target, data, "update"]);
        }
      };
      const result = await callback(transaction);
      pending.forEach(([target, data, kind]) => {
        const current = kind === "update" ? store[target.name][target.id] : {};
        store[target.name] = { ...(store[target.name] || {}), [target.id]: { ...current, ...data } };
        log.writes.push(target.path);
      });
      return result;
    }
  };
};

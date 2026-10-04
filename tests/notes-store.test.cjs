const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "notes-store.js"), "utf8");

function createStore({ fetchImpl = async () => response(200, []) } = {}) {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const context = {
    localStorage,
    location: { search: "" },
    URLSearchParams,
    Headers,
    fetch: fetchImpl,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    window: { NOTES_API_BASE_URL: "https://notes-api.example.test/" },
    BroadcastChannel: undefined,
    Date,
    Math,
    JSON,
    Object,
    String,
    Error,
    encodeURIComponent,
    Promise,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.api = {
    login, logout, getSession, isReadOnlySession, loadNotes, getNote, createNote,
    upsertNote, deleteNote, migrateProfile, getMigrationEntries, getPendingPatch, retryUncertainMigration, migrateLegacyNotes, verifyProfileMigration,
    NOTES_KEY_PREFIX, LEGACY_KEY, MIGRATION_KEY, SESSION_KEY, API_BASE_URL
  };`, context);
  return { api: context.api, localStorage, values };
}

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

function tokenFor(subject) {
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
  return `header.${payload}.signature`;
}

test("login submits urlencoded credentials and stores only the token", async () => {
  let request;
  const store = createStore({ fetchImpl: async (url, options) => {
    request = { url, options };
    return response(200, { access_token: tokenFor("alice"), token_type: "bearer" });
  } });
  await store.api.login("alice", "not-persisted");
  assert.equal(request.url, "https://notes-api.example.test/auth/login");
  assert.equal(request.options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(request.options.body, "username=alice&password=not-persisted");
  assert.equal(store.api.getSession().access_token, tokenFor("alice"));
  assert.equal([...store.values.values()].some(value => value.includes("not-persisted")), false);
});

test("protected note requests use no /api prefix and PATCH only sends changed fields", async () => {
  const requests = [];
  const store = createStore({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    return response(200, options.method === "PATCH" ? { id: "remote-1", title: "new", body: "", color: "yellow", created: 1, updated: 2 } : []);
  } });
  await store.api.login("alice", "secret");
  await store.api.loadNotes("Personal Projects", "hello world");
  await store.api.upsertNote("remote-1", { title: "new" }, "Personal Projects");
  assert.equal(requests[1].url, "https://notes-api.example.test/profiles/Personal%20Projects/notes?q=hello%20world");
  assert.equal(requests[1].options.headers.get("Authorization"), `Bearer ${tokenFor("alice")}`);
  assert.equal(requests[2].url, "https://notes-api.example.test/profiles/Personal%20Projects/notes/remote-1");
  assert.equal(requests[2].options.body, JSON.stringify({ title: "new" }));
});

test("legacy notes are merged into Keysight and original key remains as backup", () => {
  const store = createStore();
  store.localStorage.setItem("notes_app", JSON.stringify([{ id: "old", title: "legacy" }]));
  store.localStorage.setItem("notes_app_v1::Keysight", JSON.stringify([{ id: "current", title: "existing" }]));
  store.api.migrateLegacyNotes();
  assert.deepEqual(JSON.parse(store.localStorage.getItem("notes_app_v1::Keysight")).map(note => note.id), ["current", "old"]);
  assert.notEqual(store.localStorage.getItem("notes_app"), null);
});

test("successful migration records returned remote ID and preserves local source", async () => {
  let counter = 0;
  const store = createStore({ fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    counter += 1;
    assert.equal(options.method, "POST");
    return response(200, { id: "server-7", title: "Keep", body: "copy", color: "pink", created: 10, updated: 11 });
  } });
  store.localStorage.setItem("notes_app_v1::Study", JSON.stringify([{ id: "local-3", title: "Keep", body: "copy", color: "pink", created: 1, updated: 2 }]));
  await store.api.login("alice", "secret");
  const result = await store.api.migrateProfile("Study");
  assert.equal(result.migrated, 1);
  assert.equal(store.api.getMigrationEntries("Study")["local-3"].remoteId, "server-7");
  assert.equal(JSON.parse(store.localStorage.getItem("notes_app_v1::Study"))[0].id, "local-3");
  assert.equal(counter, 1);
});

test("migration verification checks returned IDs against a fresh server list", async () => {
  const store = createStore({ fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    if (options.method === "POST") return response(200, { id: "remote-ok", title: "A", body: "", color: "yellow", created: 1, updated: 1 });
    return response(200, [{ id: "remote-ok" }]);
  } });
  store.localStorage.setItem("notes_app_v1::Keysight", JSON.stringify([{ id: "local-a", title: "A" }]));
  await store.api.login("alice", "secret");
  await store.api.migrateProfile("Keysight");
  assert.equal(JSON.stringify(await store.api.verifyProfileMigration("Keysight")), JSON.stringify({ confirmed: 1, total: 1, missing: [] }));
});

test("migration manifests are isolated by authenticated subject", async () => {
  const store = createStore({ fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/login")) {
      const form = new URLSearchParams(options.body);
      return response(200, { access_token: tokenFor(form.get("username")) });
    }
    return response(200, { id: "remote-alice", title: "A", body: "", color: "yellow", created: 1, updated: 1 });
  } });
  store.localStorage.setItem("notes_app_v1::Keysight", JSON.stringify([{ id: "local-a", title: "A" }]));
  await store.api.login("alice", "secret");
  await store.api.migrateProfile("Keysight");
  store.api.logout();
  await store.api.login("bob", "secret");
  assert.equal(Object.keys(store.api.getMigrationEntries("Keysight")).length, 0);
  store.api.logout();
  await store.api.login("alice", "secret");
  assert.equal(store.api.getMigrationEntries("Keysight")["local-a"].remoteId, "remote-alice");
});

test("uncertain migration is not silently posted a second time", async () => {
  let posts = 0;
  const store = createStore({ fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    posts += 1;
    throw new TypeError("connection lost after server received request");
  } });
  store.localStorage.setItem("notes_app_v1::Keysight", JSON.stringify([{ id: "local-1", title: "Possible duplicate", body: "", color: "yellow" }]));
  await store.api.login("alice", "secret");
  await assert.rejects(store.api.migrateProfile("Keysight"), /conectar/);
  assert.equal(store.api.getMigrationEntries("Keysight")["local-1"].status, "uncertain");
  const result = await store.api.migrateProfile("Keysight");
  assert.equal(result.migrated, 0);
  assert.equal(posts, 1);
});

test("demo is read-only and cannot start migration", async () => {
  let posts = 0;
  const store = createStore({ fetchImpl: async (url, options) => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("demo") });
    if (options.method === "POST") posts += 1;
    return response(200, []);
  } });
  await store.api.login("demo", "secret");
  assert.equal(store.api.isReadOnlySession(), true);
  await assert.rejects(store.api.createNote("Keysight"), /solo puede leer/);
  await assert.rejects(store.api.migrateProfile("Keysight"), /no migrar/);
  assert.equal(posts, 0);
});

test("401 clears the app session and reports expiration", async () => {
  const store = createStore({ fetchImpl: async (url) => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    return response(401, { detail: "expired" });
  } });
  await store.api.login("alice", "secret");
  await assert.rejects(store.api.loadNotes("Keysight"), error => error.status === 401 && /expiró/.test(error.message));
  assert.equal(store.api.getSession(), null);
});

test("network failure preserves the exact pending PATCH locally", async () => {
  const store = createStore({ fetchImpl: async url => {
    if (url.endsWith("/auth/login")) return response(200, { access_token: tokenFor("alice") });
    throw new TypeError("offline");
  } });
  await store.api.login("alice", "secret");
  await assert.rejects(store.api.upsertNote("note-1", { body: "unsaved text" }, "Study"), /cambios locales/);
  assert.equal(JSON.stringify(store.api.getPendingPatch("Study", "note-1")), JSON.stringify({ body: "unsaved text" }));
});

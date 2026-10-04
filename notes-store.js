// ===== API client, app-owned session, and local migration backup =====
const NOTES_KEY_PREFIX = "notes_app_v1";
const ACTIVE_PROFILE_KEY = "notes_active_profile";
const SESSION_KEY = "notes_api_session_v1";
const MIGRATION_KEY = "notes_api_migration_v1";
const PENDING_KEY_PREFIX = "notes_api_pending_v1";
const LEGACY_KEY = "notes_app";
const PROFILES = ["Keysight", "Study", "Personal Projects"];
const API_BASE_URL = String(window.NOTES_API_BASE_URL || "https://api-dashboard-production-fc05.up.railway.app").replace(/\/+$/, "");
const notesChannel = ("BroadcastChannel" in window) ? new BroadcastChannel("notes_app") : null;

const NOTE_COLORS = {
  yellow: "#fff4b8", pink: "#ffd6e0", blue: "#d6ecff", green: "#d6f5d6", gray: "#e9e9e9",
};
const VALID_COLORS = Object.keys(NOTE_COLORS);

class NotesApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "NotesApiError";
    this.status = status;
  }
}

function notesKey(profile) {
  return `${NOTES_KEY_PREFIX}::${profile}`;
}

function getActiveProfile() {
  const fromUrl = new URLSearchParams(location.search).get("profile");
  if (fromUrl && PROFILES.includes(fromUrl)) return fromUrl;
  const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return PROFILES.includes(stored) ? stored : PROFILES[0];
}

let currentProfile = getActiveProfile();

function setActiveProfile(profile) {
  if (!PROFILES.includes(profile)) return;
  currentProfile = profile;
  localStorage.setItem(ACTIVE_PROFILE_KEY, profile);
}

function readLocalNotes(profile) {
  try {
    const notes = JSON.parse(localStorage.getItem(notesKey(profile)) || "[]");
    return Array.isArray(notes) ? notes : [];
  } catch {
    return [];
  }
}

// Preserve the old key as a backup; only write the verified, merged destination.
function migrateLegacyNotes() {
  const legacyText = localStorage.getItem(LEGACY_KEY);
  if (!legacyText) return;
  let legacyNotes;
  try { legacyNotes = JSON.parse(legacyText); }
  catch { return; }
  if (!Array.isArray(legacyNotes)) return;

  const existing = readLocalNotes(PROFILES[0]);
  const ids = new Set(existing.map(note => String(note.id)));
  const merged = existing.concat(legacyNotes.filter(note => note && note.id != null && !ids.has(String(note.id))));
  if (merged.length === existing.length) return;
  const serialized = JSON.stringify(merged);
  localStorage.setItem(notesKey(PROFILES[0]), serialized);
  const verified = JSON.parse(localStorage.getItem(notesKey(PROFILES[0])) || "[]");
  if (!Array.isArray(verified) || verified.length !== merged.length) {
    throw new Error("No se pudo verificar la copia local de las notas antiguas.");
  }
}

migrateLegacyNotes();

function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return session && typeof session.access_token === "string" ? session : null;
  } catch {
    return null;
  }
}

function tokenSubject(token) {
  try {
    let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - payload.length % 4) % 4);
    return JSON.parse(atob(payload)).sub || "";
  } catch {
    return "";
  }
}

function isReadOnlySession(session = getSession()) {
  return Boolean(session && String(session.sub || "").toLowerCase() === "demo");
}

function publish(type, profile = currentProfile, id = null) {
  const message = { type, id, profile, from: Date.now() };
  if (notesChannel) notesChannel.postMessage(message);
  localStorage.setItem("notes_api_signal_v1", JSON.stringify(message));
}

async function login(username, password) {
  const form = new URLSearchParams({ username, password });
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    throw new NotesApiError("No se pudo conectar con el servicio. Comprueba la red e inténtalo de nuevo.");
  }
  const payload = await responseJson(response);
  if (!response.ok) throw new NotesApiError(payload.detail || "No se pudo iniciar sesión.", response.status);
  if (!payload.access_token) throw new NotesApiError("El servidor no devolvió un access_token válido.");

  const session = {
    access_token: payload.access_token,
    sub: tokenSubject(payload.access_token) || (String(username).toLowerCase() === "demo" ? "demo" : ""),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  publish("auth", currentProfile);
  return session;
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  publish("logout", currentProfile);
}

async function responseJson(response) {
  try { return await response.json(); }
  catch { return {}; }
}

async function apiRequest(path, options = {}) {
  const session = getSession();
  if (!session) throw new NotesApiError("Inicia sesión para continuar.", 401);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new NotesApiError("No se pudo conectar con el servicio. Tus cambios locales se conservaron.");
  }
  const payload = response.status === 204 ? null : await responseJson(response);
  if (response.status === 401) {
    logout();
    throw new NotesApiError("La sesión expiró. Inicia sesión de nuevo; los cambios pendientes se conservaron.", 401);
  }
  if (!response.ok) {
    throw new NotesApiError(payload && payload.detail || `Error del servicio (${response.status}).`, response.status);
  }
  return payload;
}

function profilePath(profile) {
  if (!PROFILES.includes(profile)) throw new NotesApiError("Perfil no válido.");
  return `/profiles/${encodeURIComponent(profile)}/notes`;
}

async function loadNotes(profile = currentProfile, query = "") {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  const notes = await apiRequest(`${profilePath(profile)}${suffix}`);
  if (!Array.isArray(notes)) throw new NotesApiError("El servicio devolvió una lista de notas no válida.");
  return notes.sort((a, b) => b.created - a.created);
}

async function getNote(id, profile = currentProfile) {
  return apiRequest(`${profilePath(profile)}/${encodeURIComponent(id)}`);
}

async function createNote(profile = currentProfile) {
  if (isReadOnlySession()) throw new NotesApiError("La cuenta demo solo puede leer notas.", 403);
  const note = await apiRequest(profilePath(profile), { method: "POST", body: "{}" });
  publish("changed", profile, note.id);
  return note;
}

function pendingKey(profile) {
  const subject = getSession()?.sub || "unknown";
  return `${PENDING_KEY_PREFIX}::${encodeURIComponent(subject)}::${profile}`;
}

function readPending(profile) {
  try { return JSON.parse(localStorage.getItem(pendingKey(profile)) || "{}"); }
  catch { return {}; }
}

function savePendingPatch(profile, id, patch) {
  const pending = readPending(profile);
  pending[id] = { ...(pending[id] || {}), ...patch };
  localStorage.setItem(pendingKey(profile), JSON.stringify(pending));
}

function getPendingPatch(profile, id) {
  return readPending(profile)[id] || {};
}

function clearPendingPatch(profile, id, savedPatch) {
  const pending = readPending(profile);
  if (!pending[id]) return;
  for (const [key, value] of Object.entries(savedPatch)) {
    if (pending[id][key] === value) delete pending[id][key];
  }
  if (Object.keys(pending[id]).length === 0) delete pending[id];
  localStorage.setItem(pendingKey(profile), JSON.stringify(pending));
}

async function upsertNote(id, patch, profile = currentProfile) {
  if (isReadOnlySession()) throw new NotesApiError("La cuenta demo solo puede leer notas.", 403);
  const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => ["title", "body", "color"].includes(key)));
  if (Object.keys(allowed).length === 0) return getNote(id, profile);
  if (Object.hasOwn(allowed, "color") && !VALID_COLORS.includes(allowed.color)) {
    throw new NotesApiError("Color de nota no válido.");
  }
  savePendingPatch(profile, id, allowed);
  const saved = await apiRequest(`${profilePath(profile)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(allowed),
  });
  clearPendingPatch(profile, id, allowed);
  publish("changed", profile, id);
  return saved;
}

async function deleteNote(id, profile = currentProfile) {
  if (isReadOnlySession()) throw new NotesApiError("La cuenta demo solo puede leer notas.", 403);
  await apiRequest(`${profilePath(profile)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  const pending = readPending(profile);
  delete pending[id];
  localStorage.setItem(pendingKey(profile), JSON.stringify(pending));
  publish("deleted", profile, id);
}

function manifestStorageKey() {
  const subject = getSession()?.sub || "unknown";
  return `${MIGRATION_KEY}::${encodeURIComponent(subject)}`;
}

function readManifest() {
  try {
    const value = JSON.parse(localStorage.getItem(manifestStorageKey()) || "{}");
    return value.profiles || {};
  } catch {
    return {};
  }
}

function writeManifest(profiles) {
  localStorage.setItem(manifestStorageKey(), JSON.stringify({ version: 1, profiles }));
}

function getMigrationEntries(profile) {
  return readManifest()[profile] || {};
}

function saveMigrationEntry(profile, localId, entry) {
  const profiles = readManifest();
  profiles[profile] = { ...(profiles[profile] || {}), [localId]: entry };
  writeManifest(profiles);
}

function localNotePayload(note) {
  return {
    title: String(note.title || ""),
    body: String(note.body || ""),
    color: VALID_COLORS.includes(note.color) ? note.color : "yellow",
  };
}

async function migrateOneLocalNote(profile, note) {
  const localId = String(note.id);
  // Persist uncertainty before POST: a lost response must never trigger a silent duplicate.
  saveMigrationEntry(profile, localId, { status: "uncertain", updatedAt: Date.now() });
  const created = await apiRequest(profilePath(profile), {
    method: "POST",
    body: JSON.stringify(localNotePayload(note)),
  });
  saveMigrationEntry(profile, localId, { status: "migrated", remoteId: String(created.id), updatedAt: Date.now() });
  publish("changed", profile, created.id);
}

async function migrateProfile(profile, onProgress = () => {}) {
  if (isReadOnlySession()) throw new NotesApiError("La cuenta demo puede leer, pero no migrar ni editar notas.", 403);
  if (!PROFILES.includes(profile)) throw new NotesApiError("Perfil no válido.");
  const notes = readLocalNotes(profile);
  let entries = getMigrationEntries(profile);
  const uncertain = Object.values(entries).filter(entry => entry.status === "uncertain").length;
  let migrated = 0;
  for (const note of notes) {
    if (note.id == null) continue;
    entries = getMigrationEntries(profile);
    if (entries[String(note.id)]?.status === "migrated" || entries[String(note.id)]?.status === "uncertain") continue;
    onProgress({ note, migrated, total: notes.length });
    await migrateOneLocalNote(profile, note);
    migrated += 1;
  }
  return { migrated, total: notes.length, uncertain };
}

async function verifyProfileMigration(profile) {
  if (!PROFILES.includes(profile)) throw new NotesApiError("Perfil no válido.");
  const remoteNotes = await loadNotes(profile);
  const remoteIds = new Set(remoteNotes.map(note => String(note.id)));
  const entries = Object.entries(getMigrationEntries(profile)).filter(([, entry]) => entry.status === "migrated");
  const missing = entries.filter(([, entry]) => !remoteIds.has(String(entry.remoteId))).map(([localId]) => localId);
  return { confirmed: entries.length - missing.length, total: entries.length, missing };
}

async function retryUncertainMigration(profile, localId, confirm) {
  if (isReadOnlySession()) throw new NotesApiError("La cuenta demo solo puede leer notas.", 403);
  const note = readLocalNotes(profile).find(item => String(item.id) === String(localId));
  if (!note) throw new NotesApiError("No se encontró la nota local original.");
  const current = getMigrationEntries(profile)[String(localId)];
  if (!current || current.status !== "uncertain") return false;

  const remoteNotes = await loadNotes(profile);
  const payload = localNotePayload(note);
  const mappedIds = new Set(Object.values(getMigrationEntries(profile)).filter(entry => entry.status === "migrated").map(entry => entry.remoteId));
  const candidates = remoteNotes.filter(remote => !mappedIds.has(String(remote.id)) &&
    remote.title === payload.title && remote.body === payload.body && remote.color === payload.color);

  if (candidates.length === 1) {
    const useCandidate = await confirm(`Hay una nota remota con el mismo contenido (ID ${candidates[0].id}). ¿Vincularla a la nota local sin crear otra?`);
    if (useCandidate) {
      saveMigrationEntry(profile, String(localId), { status: "migrated", remoteId: String(candidates[0].id), updatedAt: Date.now(), reconciled: true });
      return true;
    }
  }
  const warning = candidates.length > 1
    ? "Hay varias notas remotas iguales. No se puede determinar cuál procede de esta nota. Si continúas se creará otra nota. ¿Continuar de todos modos?"
    : "No se encontró una nota remota idéntica. Si el POST anterior se procesó y se perdió la respuesta, continuar puede crear un duplicado. ¿Reintentar de todos modos?";
  if (!await confirm(warning)) return false;
  await migrateOneLocalNote(profile, note);
  return true;
}

function broadcast(type, id) {
  publish(type, currentProfile, id);
}

// Open a note in its OWN window; reusing the window name focuses it if already open.
function openNoteWindow(id) {
  const w = window.open(
    `note.html?id=${encodeURIComponent(id)}&profile=${encodeURIComponent(currentProfile)}`,
    `note_${id}`,
    "width=460,height=580,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes");
  if (w) w.focus();
  return w;
}

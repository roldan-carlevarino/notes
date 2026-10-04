// ===== Single note window (editor) =====
const params = new URLSearchParams(location.search);
const noteId = params.get("id");
const profile = currentProfile;
const $title = document.getElementById("note-title");
const $body = document.getElementById("note-body");
const $meta = document.getElementById("note-meta");
const $saved = document.getElementById("saved-state");
const $sessionState = document.getElementById("editor-session-state");
const $delete = document.getElementById("delete-note");
const $retry = document.getElementById("retry-save");
let note = null;
let saveTimer = null;
let pendingChanges = {};
let saveQueue = Promise.resolve();
let readOnly = false;

function applyColor(color) {
  document.body.dataset.color = color;
  document.body.style.setProperty("--note-bg", NOTE_COLORS[color] || NOTE_COLORS.yellow);
  document.querySelectorAll("#colors .dot").forEach(dot => dot.classList.toggle("active", dot.dataset.color === color));
}

function paintMeta() {
  if (!note) return;
  const date = new Date(note.updated);
  $meta.textContent = `${profile} · Editado ${date.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
  document.title = `[${profile}] ${((note.title || note.body.split("\n")[0] || "Nota").slice(0, 40) || "Nota")}`;
}

function setEditorEnabled(enabled) {
  const writable = enabled && !readOnly;
  $title.disabled = !writable;
  $body.disabled = !writable;
  $delete.disabled = !writable;
  $retry.hidden = !writable || Object.keys(getPendingPatch(profile, noteId)).length === 0;
  $retry.disabled = !writable;
  document.querySelectorAll("#colors .dot").forEach(dot => { dot.disabled = !writable; });
  $sessionState.textContent = !enabled ? "Inicia sesión en la ventana principal para continuar." : readOnly ? "Demo: solo lectura." : "";
}

function renderPendingDraft() {
  const draft = getPendingPatch(profile, noteId);
  if (Object.hasOwn(draft, "title")) $title.value = draft.title;
  if (Object.hasOwn(draft, "body")) $body.value = draft.body;
  if (Object.hasOwn(draft, "color")) applyColor(draft.color);
  pendingChanges = { ...draft };
  if (Object.keys(draft).length) $saved.textContent = "Cambios pendientes";
}

async function loadEditor() {
  const session = getSession();
  readOnly = isReadOnlySession(session);
  setEditorEnabled(Boolean(session));
  if (!session || !noteId) return;
  $saved.textContent = "Cargando…";
  try {
    note = await getNote(noteId, profile);
    $title.value = note.title || "";
    $body.value = note.body || "";
    applyColor(note.color || "yellow");
    paintMeta();
    renderPendingDraft();
    if (readOnly) {
      $saved.textContent = "Solo lectura";
    } else if (Object.keys(pendingChanges).length) {
      $saved.textContent = "Reintentando cambios pendientes…";
      await flushChanges();
    } else {
      $saved.textContent = "Guardado";
    }
    setEditorEnabled(true);
    if (!readOnly) $body.focus();
  } catch (error) {
    $saved.textContent = error.message;
    setEditorEnabled(Boolean(getSession()));
  }
}

function queuePatch(patch) {
  saveQueue = saveQueue.then(async () => {
    if (!getSession() || readOnly || !Object.keys(patch).length) return;
    try {
      const saved = await upsertNote(noteId, patch, profile);
      note = { ...note, ...saved };
      paintMeta();
      const hasPending = Object.keys(getPendingPatch(profile, noteId)).length > 0;
      $retry.hidden = !hasPending;
      $saved.textContent = hasPending ? "Cambios pendientes" : "Guardado";
    } catch (error) {
      pendingChanges = { ...patch, ...pendingChanges };
      $retry.hidden = false;
      $saved.textContent = `Pendiente: ${error.message}`;
      if (error.status === 401) setEditorEnabled(false);
    }
  });
  return saveQueue;
}

function scheduleFieldSave(field, value) {
  pendingChanges[field] = value;
  savePendingPatch(profile, noteId, { [field]: value });
  $saved.textContent = "Guardando…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushChanges, 400);
}

function flushChanges() {
  clearTimeout(saveTimer);
  if (!Object.keys(pendingChanges).length) return Promise.resolve();
  const patch = pendingChanges;
  pendingChanges = {};
  return queuePatch(patch);
}

$retry.addEventListener("click", () => {
  $saved.textContent = "Reintentando…";
  flushChanges();
});

$title.addEventListener("input", () => scheduleFieldSave("title", $title.value));
$body.addEventListener("input", () => scheduleFieldSave("body", $body.value));
$title.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); $body.focus(); }
});

document.getElementById("colors").addEventListener("click", event => {
  const dot = event.target.closest(".dot");
  if (!dot || readOnly || !note) return;
  applyColor(dot.dataset.color);
  scheduleFieldSave("color", dot.dataset.color);
  flushChanges();
});

$delete.addEventListener("click", async () => {
  if (!confirm("¿Eliminar esta nota?")) return;
  try {
    await flushChanges();
    await deleteNote(noteId, profile);
    window.close();
  } catch (error) {
    $saved.textContent = error.message;
  }
});

window.addEventListener("beforeunload", () => { flushChanges(); });

function onMessage(message) {
  if (!message) return;
  if (message.type === "logout") {
    readOnly = false;
    setEditorEnabled(false);
    $saved.textContent = Object.keys(getPendingPatch(profile, noteId)).length ? "Sesión cerrada; borrador conservado" : "Sesión cerrada";
  } else if (message.type === "auth") {
    loadEditor();
  } else if (message.profile === profile && message.id === noteId && message.type === "deleted") {
    window.close();
  }
}

if (notesChannel) notesChannel.onmessage = event => onMessage(event.data);
window.addEventListener("storage", event => {
  if (event.key === SESSION_KEY || event.key === "notes_api_signal_v1") {
    const message = event.key === "notes_api_signal_v1" ? JSON.parse(event.newValue || "null") : null;
    if (!message || ["auth", "logout"].includes(message.type)) onMessage(message || { type: getSession() ? "auth" : "logout" });
  }
});

setEditorEnabled(Boolean(getSession()));
loadEditor();

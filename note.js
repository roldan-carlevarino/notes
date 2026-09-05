// ===== Single note window (editor) =====
const params = new URLSearchParams(location.search);
let noteId = params.get("id");

const $title = document.getElementById("note-title");
const $body = document.getElementById("note-body");
const $meta = document.getElementById("note-meta");
const $saved = document.getElementById("saved-state");

// Load (or create if missing)
let note = noteId ? getNote(noteId) : null;
if (!note) {
  note = createNote();
  noteId = note.id;
  history.replaceState(null, "", `note.html?id=${noteId}`);
}

function applyColor(color) {
  document.body.dataset.color = color;
  document.body.style.setProperty("--note-bg", NOTE_COLORS[color] || NOTE_COLORS.yellow);
  document.querySelectorAll("#colors .dot").forEach(d =>
    d.classList.toggle("active", d.dataset.color === color));
}

function paintMeta() {
  const d = new Date(note.updated);
  $meta.textContent = "Editado " + d.toLocaleString("es-ES",
    { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  document.title = (note.title || note.body.split("\n")[0] || "Nota").slice(0, 40) || "Nota";
}

// Initial paint
$title.value = note.title || "";
$body.value = note.body || "";
applyColor(note.color || "yellow");
paintMeta();

// Autosave (debounced)
let saveTimer = null;
function scheduleSave() {
  $saved.textContent = "Guardando…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 400);
}
function commit() {
  note.title = $title.value;
  note.body = $body.value;
  note.updated = Date.now();
  upsertNote(note);
  paintMeta();
  $saved.textContent = "Guardado";
}

$title.addEventListener("input", scheduleSave);
$body.addEventListener("input", scheduleSave);
$title.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $body.focus(); }
});

// Color picker
document.getElementById("colors").addEventListener("click", (e) => {
  const dot = e.target.closest(".dot");
  if (!dot) return;
  note.color = dot.dataset.color;
  applyColor(note.color);
  commit();
});

// Delete
document.getElementById("delete-note").addEventListener("click", () => {
  if (confirm("¿Eliminar esta nota?")) {
    deleteNote(noteId);
    window.close();
  }
});

// Save on close
window.addEventListener("beforeunload", commit);

// React if this note is deleted from elsewhere
if (notesChannel) notesChannel.onmessage = (ev) => {
  if (ev.data && ev.data.type === "deleted" && ev.data.id === noteId) window.close();
};

$body.focus();

// ===== Shared notes store (localStorage + cross-window sync) =====
const NOTES_KEY = "notes_app_v1";
const notesChannel = ("BroadcastChannel" in window) ? new BroadcastChannel("notes_app") : null;

const NOTE_COLORS = {
  yellow: "#fff4b8", pink: "#ffd6e0", blue: "#d6ecff", green: "#d6f5d6", gray: "#e9e9e9",
};

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }
  catch { return []; }
}
function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}
function getNote(id) {
  return loadNotes().find(n => n.id === id) || null;
}
function upsertNote(note) {
  const notes = loadNotes();
  const i = notes.findIndex(n => n.id === note.id);
  if (i >= 0) notes[i] = note; else notes.push(note);
  saveNotes(notes);
  broadcast("changed", note.id);
}
function deleteNote(id) {
  saveNotes(loadNotes().filter(n => n.id !== id));
  broadcast("deleted", id);
}
function createNote() {
  const now = Date.now();
  const note = { id: "n" + now + Math.random().toString(36).slice(2, 7),
                 title: "", body: "", color: "yellow", created: now, updated: now };
  const notes = loadNotes();
  notes.push(note);
  saveNotes(notes);
  broadcast("changed", note.id);
  return note;
}
function broadcast(type, id) {
  if (notesChannel) notesChannel.postMessage({ type, id, from: Date.now() });
}

// Open a note in its OWN window; reusing the window name focuses it if already open.
function openNoteWindow(id) {
  const w = window.open(`note.html?id=${encodeURIComponent(id)}`, `note_${id}`,
    "width=460,height=580,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes");
  if (w) w.focus();
  return w;
}

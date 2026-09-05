// ===== Notes list window =====
let searchTerm = "";

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year:
        d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function preview(note) {
  const text = (note.body || "").trim().replace(/\s+/g, " ");
  return text || "Sin contenido adicional";
}
function titleOf(note) {
  return (note.title || "").trim()
    || (note.body || "").trim().split("\n")[0].slice(0, 40)
    || "Nueva nota";
}

function render() {
  const list = document.getElementById("note-list");
  const notes = loadNotes()
    .filter(n => {
      if (!searchTerm) return true;
      return (n.title + " " + n.body).toLowerCase().includes(searchTerm);
    })
    .sort((a, b) => b.updated - a.updated);

  document.getElementById("empty").hidden = loadNotes().length !== 0;

  list.innerHTML = notes.map(n => `
    <li class="note-item" data-id="${n.id}" style="--accent:${NOTE_COLORS[n.color] || NOTE_COLORS.yellow}">
      <span class="note-swatch"></span>
      <div class="note-item-main">
        <div class="note-item-title">${escapeHtml(titleOf(n))}</div>
        <div class="note-item-sub">
          <span class="note-item-date">${fmtDate(n.updated)}</span>
          <span class="note-item-preview">${escapeHtml(preview(n))}</span>
        </div>
      </div>
      <button class="note-item-del" title="Eliminar">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </li>`).join("");

  list.querySelectorAll(".note-item").forEach(el => {
    const id = el.dataset.id;
    el.addEventListener("click", (e) => {
      if (e.target.closest(".note-item-del")) return;
      openNoteWindow(id);
    });
    el.querySelector(".note-item-del").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("¿Eliminar esta nota?")) deleteNote(id);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// New note -> create and open in its own window
document.getElementById("new-note").addEventListener("click", () => {
  const note = createNote();
  render();
  openNoteWindow(note.id);
});

document.getElementById("search").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

// Live updates from note windows
if (notesChannel) notesChannel.onmessage = () => render();
window.addEventListener("storage", (e) => { if (e.key === NOTES_KEY) render(); });

render();

// ===== Notes list window =====
let searchTerm = "";
let renderSequence = 0;
let searchTimer = null;

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function preview(note) {
  return (note.body || "").trim().replace(/\s+/g, " ") || "Sin contenido adicional";
}

function titleOf(note) {
  return (note.title || "").trim() || (note.body || "").trim().split("\n")[0].slice(0, 40) || "Nueva nota";
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function setAuthUi() {
  const session = getSession();
  const authenticated = Boolean(session);
  const readOnly = isReadOnlySession(session);
  document.getElementById("login-panel").hidden = authenticated;
  document.getElementById("notes-app").hidden = !authenticated;
  document.getElementById("account-label").hidden = !authenticated;
  document.getElementById("logout").hidden = !authenticated;
  document.getElementById("new-note").hidden = !authenticated || readOnly;
  document.getElementById("account-label").textContent = readOnly ? "Demo · solo lectura" : "Sesión activa";
  document.getElementById("migrate-local").hidden = !authenticated || readOnly;
  document.getElementById("migration-state").textContent = readOnly
    ? "La cuenta demo puede leer notas, pero no editar ni migrar datos."
    : "";
  if (!authenticated) document.getElementById("note-list").replaceChildren();
  refreshMigrationUi();
}

async function render() {
  if (!getSession()) return;
  const sequence = ++renderSequence;
  const list = document.getElementById("note-list");
  const error = document.getElementById("list-error");
  error.textContent = "";
  try {
    const notes = await loadNotes(currentProfile, searchTerm);
    if (sequence !== renderSequence || currentProfile !== getActiveProfile()) return;
    const groups = [];
    for (const note of notes) {
      const key = dayKey(note.created);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        group = { key, created: note.created, notes: [] };
        groups.push(group);
      }
      group.notes.push(note);
    }
    list.innerHTML = groups.map(group => `
      <li class="note-group-header">${escapeHtml(dayLabel(group.created))}</li>
      ${group.notes.map(note => `
      <li class="note-item" data-id="${escapeHtml(note.id)}" style="--accent:${NOTE_COLORS[note.color] || NOTE_COLORS.yellow}">
        <span class="note-swatch"></span>
        <div class="note-item-main">
          <div class="note-item-title">${escapeHtml(titleOf(note))}</div>
          <div class="note-item-sub">
            <span class="note-item-date">${fmtDate(note.updated)}</span>
            <span class="note-item-preview">${escapeHtml(preview(note))}</span>
          </div>
        </div>
        ${isReadOnlySession() ? "" : `<button class="note-item-del" title="Eliminar" aria-label="Eliminar nota">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`}
      </li>`).join("")}`).join("");
    document.getElementById("empty").hidden = notes.length !== 0;
    list.querySelectorAll(".note-item").forEach(element => {
      const id = element.dataset.id;
      element.addEventListener("click", event => {
        if (event.target.closest(".note-item-del")) return;
        openNoteWindow(id);
      });
      element.querySelector(".note-item-del")?.addEventListener("click", async event => {
        event.stopPropagation();
        if (!confirm("¿Eliminar esta nota?")) return;
        try {
          await deleteNote(id, currentProfile);
          await render();
        } catch (error) {
          document.getElementById("list-error").textContent = error.message;
        }
      });
    });
  } catch (error) {
    if (sequence === renderSequence) document.getElementById("list-error").textContent = error.message;
  }
}

function renderProfiles() {
  const tabs = document.getElementById("profile-tabs");
  tabs.innerHTML = PROFILES.map(profile => `
    <button class="profile-tab${profile === currentProfile ? " active" : ""}" data-profile="${escapeHtml(profile)}">
      ${escapeHtml(profile)}
    </button>`).join("");
  tabs.querySelectorAll(".profile-tab").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.profile === currentProfile) return;
      setActiveProfile(button.dataset.profile);
      searchTerm = "";
      document.getElementById("search").value = "";
      renderProfiles();
      render();
      refreshMigrationUi();
    });
  });
}

function refreshMigrationUi() {
  const list = document.getElementById("migration-uncertain");
  if (!list) return;
  const demo = isReadOnlySession();
  const localNotes = readLocalNotes(currentProfile);
  const entries = getMigrationEntries(currentProfile);
  const migrated = Object.values(entries).filter(entry => entry.status === "migrated").length;
  const uncertain = Object.entries(entries).filter(([, entry]) => entry.status === "uncertain");
  if (!demo && getSession()) {
    document.getElementById("migration-state").textContent = `${migrated} de ${localNotes.length} notas locales confirmadas para ${currentProfile}. La copia original se conserva.`;
  }
  list.innerHTML = uncertain.map(([id]) => {
    const note = localNotes.find(item => String(item.id) === id);
    return `<li>Resultado incierto: ${escapeHtml(titleOf(note || {}))} <button class="resolve-migration" data-id="${escapeHtml(id)}">Revisar reintento</button></li>`;
  }).join("");
  list.querySelectorAll(".resolve-migration").forEach(button => button.addEventListener("click", async () => {
    try {
      const resolved = await retryUncertainMigration(currentProfile, button.dataset.id, message => Promise.resolve(confirm(message)));
      document.getElementById("migration-state").textContent = resolved ? "Nota local vinculada o reintentada." : "No se realizó ningún reintento.";
      refreshMigrationUi();
      await render();
    } catch (error) {
      document.getElementById("migration-state").textContent = error.message;
    }
  }));
}

document.getElementById("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const passwordField = document.getElementById("login-password");
  const submit = event.currentTarget.querySelector("button[type=submit]");
  const message = document.getElementById("login-error");
  message.textContent = "Conectando…";
  submit.disabled = true;
  try {
    await login(username, passwordField.value);
    passwordField.value = "";
    message.textContent = "";
    setAuthUi();
    renderProfiles();
    await render();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("logout").addEventListener("click", () => {
  logout();
  setAuthUi();
});

document.getElementById("new-note").addEventListener("click", async () => {
  try {
    const note = await createNote(currentProfile);
    openNoteWindow(note.id);
    await render();
  } catch (error) {
    document.getElementById("list-error").textContent = error.message;
  }
});

document.getElementById("search").addEventListener("input", event => {
  searchTerm = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 250);
});

document.getElementById("migrate-local").addEventListener("click", async () => {
  const button = document.getElementById("migrate-local");
  button.disabled = true;
  document.getElementById("migration-state").textContent = "Migrando. No cierres esta ventana…";
  try {
    const result = await migrateProfile(currentProfile);
    const unresolved = Object.values(getMigrationEntries(currentProfile)).filter(entry => entry.status === "uncertain").length;
    const verification = await verifyProfileMigration(currentProfile);
    document.getElementById("migration-state").textContent = `${result.migrated} notas migradas; ${verification.confirmed}/${verification.total} correspondencias verificadas en servidor; ${unresolved} resultado(s) incierto(s). IDs y fechas históricos permanecen solo en la copia local.`;
    refreshMigrationUi();
    await render();
  } catch (error) {
    document.getElementById("migration-state").textContent = `${error.message} La copia local se conserva; revisa los resultados inciertos antes de reintentar.`;
    refreshMigrationUi();
  } finally {
    button.disabled = false;
  }
});

document.getElementById("verify-migration").addEventListener("click", async () => {
  const button = document.getElementById("verify-migration");
  button.disabled = true;
  document.getElementById("migration-state").textContent = "Comprobando las notas confirmadas en el servidor…";
  try {
    const result = await verifyProfileMigration(currentProfile);
    document.getElementById("migration-state").textContent = result.missing.length
      ? `${result.confirmed}/${result.total} correspondencias visibles. ${result.missing.length} no aparecen en la lista del servidor; la copia local sigue intacta.`
      : `${result.confirmed}/${result.total} correspondencias visibles en el servidor. La copia local sigue intacta.`;
  } catch (error) {
    document.getElementById("migration-state").textContent = `${error.message} No se modificó la copia local.`;
  } finally {
    button.disabled = false;
  }
});

if (notesChannel) notesChannel.onmessage = event => {
  const message = event.data;
  if (!message) return;
  if (["auth", "logout"].includes(message.type)) {
    setAuthUi();
    if (getSession()) render();
  } else if (message.profile === currentProfile && ["changed", "deleted"].includes(message.type)) {
    render();
  }
};
window.addEventListener("storage", event => {
  if (event.key === SESSION_KEY || event.key === "notes_api_signal_v1") {
    setAuthUi();
    if (getSession()) render();
  }
});

setAuthUi();
renderProfiles();
render();

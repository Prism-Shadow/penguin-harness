// The Slides page: a deck picker, the Bento editor in a sandboxed frame, and a rail that asks
// the Agent to change the open deck.
//
// One deck is one file the handler serves. The page keeps the editor and the file in step:
//   - the person edits   -> the frame reports the document -> saved to the file;
//   - the Agent edits    -> the handler's stream says the file changed -> loaded into the editor,
//     with whatever the person did meanwhile replayed on top (./sync.js).
// The editor never talks to anything but this page: its frame has no origin of its own and a
// policy that allows no connection, so the Bento runtime cannot reach the network or the app.
import { bridge } from "./bridge.js";
import { draftOf, emptyLive, foldLive } from "./live.js";
import { S, locale } from "./strings.js";
import {
  deckFromHtml,
  diff,
  formatDeck,
  htmlWithDeck,
  isEmpty,
  parseDeck,
  rebase,
} from "./sync.js";

const RUNTIME = "vendor/bento-slides-1.2.13.runtime.txt";
const SDK = "../sdk/workbench.js";
const SAVE_AFTER_MS = 700;
const LOAD_TIMEOUT_MS = 30_000;
const TAG = "__slides";
/** What the editor's frame may load: itself, inline, and nothing over the network. */
const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const $ = (id) => document.getElementById(id);
const app = $("app");
const frame = $("editor");

document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
for (const el of document.querySelectorAll("[data-copy]")) el.textContent = S[el.dataset.copy];
$("prompt").placeholder = S.promptPlaceholder;
$("start-prompt").placeholder = S.startPlaceholder;

const api = (path, init) => fetch(`../api${path}`, init);
const send = (path, method, body) =>
  api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function getJson(path) {
  const res = await api(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

let runtime = null;
let decks = [];
/** The open deck, or null: see `openDeck` for its fields. */
let open = null;
let cursor = { index: 0, slideId: null, selection: [] };

// ---- views -------------------------------------------------------------------------------

function setView(view) {
  app.dataset.view = view;
}
function setSync(key, tone = "") {
  $("sync").textContent = key === "" ? "" : S[key];
  $("sync").dataset.tone = tone;
}
let noticeTimer = null;
/** A line under the bar; `ms` 0 keeps it up, `action` adds a button that does something about it. */
function notice(text, ms = 12_000, action = null) {
  const line = $("notice");
  line.replaceChildren(text);
  if (action !== null) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.textContent = action.label;
    button.onclick = () => {
      line.hidden = true;
      action.run();
    };
    line.append(" ", button);
  }
  line.hidden = false;
  clearTimeout(noticeTimer);
  if (ms > 0) noticeTimer = setTimeout(() => (line.hidden = true), ms);
}

const TRASH =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function refreshDecks() {
  decks = (await getJson("/decks")).decks;
  renderDeckMenu();
  const current = decks.find((deck) => deck.id === open?.id);
  $("deck-title").textContent = current?.title || open?.shown?.title || S.untitled;
}

/** The deck whose delete button has had its first click, for a few seconds: it waits for the second. */
let armed = null;
let armedTimer = null;
function arm(id) {
  armed = id;
  clearTimeout(armedTimer);
  if (id !== null) {
    armedTimer = setTimeout(() => {
      armed = null;
      renderDeckMenu();
    }, 4000);
  }
}

function renderDeckMenu() {
  $("deck-menu").replaceChildren(
    ...decks.map((deck) => {
      const item = document.createElement("li");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(open?.id === deck.id));
      item.dataset.id = deck.id;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = deck.title || S.untitled;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = S.slides(deck.slides);
      // Deleting takes a second click on the same button: the frame has no confirm().
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-action";
      remove.dataset.delete = deck.id;
      remove.title = S.deleteDeck;
      remove.setAttribute("aria-label", S.deleteDeck);
      if (armed === deck.id) {
        remove.dataset.armed = "1";
        remove.textContent = S.confirmDelete;
      } else remove.innerHTML = TRASH;
      item.append(name, meta, remove);
      return item;
    }),
  );
}

// ---- the editor frame ---------------------------------------------------------------------

/** The Bento runtime with `doc` in it, the frame's policy, and the bridge that reports to us. */
function editorHtml(doc, token) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`;
  const script = `<script>(${bridge.toString()})(${JSON.stringify(token)})</` + "script>";
  return htmlWithDeck(runtime, doc)
    .replace(/<head>/i, `<head>${policy}`)
    .replace(/<\/body>/i, `${script}</body>`);
}

let loads = 0;
const waiting = new Map();
/** Hands the editor a document; resolves with what it held just before and what it shows now. */
function loadIntoEditor(o, doc) {
  const id = ++loads;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("the editor did not take the document"));
    }, LOAD_TIMEOUT_MS);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    frame.contentWindow.postMessage(
      { [TAG]: 1, token: o.token, type: "load", id, json: JSON.stringify(doc) },
      "*",
    );
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (event.source !== frame.contentWindow || !message || message[TAG] !== 1) return;
  if (open === null || message.token !== open.token) return;
  if (message.type === "ready") {
    open.shown = message.doc;
    open.mine = message.doc;
    open.ready = true;
    setSync("synced");
    void refreshDecks();
  } else if (message.type === "changed") {
    open.mine = message.doc;
    scheduleSave(open);
  } else if (message.type === "loaded") {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  } else if (message.type === "cursor") {
    cursor = { index: message.index, slideId: message.slideId, selection: message.selection };
    renderContext();
  }
});

function renderContext() {
  const total = open?.mine?.slides?.length ?? 0;
  const parts = total > 0 ? [S.contextSlide(Math.min(cursor.index + 1, total), total)] : [];
  if (cursor.selection.length > 0) parts.push(S.contextSelection(cursor.selection.length));
  $("context").textContent = parts.join(" · ");
}

// ---- keeping the editor and the file in step ----------------------------------------------

/** Runs `work` after whatever this deck is already doing: saves and loads never interleave. */
function inTurn(o, work) {
  const run = o.turn.then(work, work);
  o.turn = run.catch(() => undefined);
  return run;
}

/** Edits the person made that the file does not hold yet. */
const unsaved = (o) => [...o.carry, diff(o.shown, o.mine)].filter((edits) => !isEmpty(edits));

function scheduleSave(o) {
  clearTimeout(o.timer);
  setSync("saving", "busy");
  o.timer = setTimeout(() => void inTurn(o, () => save(o)), SAVE_AFTER_MS);
}

async function save(o) {
  if (open !== o || !o.ready || o.gone) return;
  if (unsaved(o).length === 0) {
    setSync("synced");
    return;
  }
  const mine = o.mine;
  let res;
  try {
    res = await send(`/decks/${o.id}`, "PUT", { text: formatDeck(mine), base: o.rev });
  } catch {
    setSync("offline", "attention");
    return;
  }
  if (res.status === 409) {
    const current = await res.json();
    await takeTheirs(o, current.rev, current.text);
    return;
  }
  if (res.status === 404) {
    deckGone(o);
    return;
  }
  if (!res.ok) {
    setSync("offline", "attention");
    return;
  }
  o.rev = (await res.json()).rev;
  o.base = parseDeck(formatDeck(mine));
  o.shown = mine;
  o.carry = [];
  if (o.mine !== mine) scheduleSave(o);
  else setSync("synced");
  void refreshDecks();
}

/**
 * The file moved on under the editor (the Agent wrote it): put its document in the editor with
 * the person's unsaved edits replayed on it, then save the result when there were any.
 */
async function takeTheirs(o, rev, text) {
  if (open !== o || rev === o.rev) return;
  let theirs;
  try {
    theirs = parseDeck(text);
  } catch (err) {
    // Half-written by the Agent, or broken: the editor keeps what it has until the next write.
    notice(S.badFile(err instanceof Error ? err.message : String(err)));
    return;
  }
  const clashes = [];
  for (let round = 0; round < 4; round++) {
    const used = o.mine;
    const pending = unsaved(o);
    let doc = theirs;
    for (const edits of pending) {
      const merged = rebase(doc, edits, o.base);
      doc = merged.doc;
      clashes.push(...merged.clashes);
    }
    const loaded = await loadIntoEditor(o, doc);
    if (open !== o) return;
    // What the person did between our reading of the editor and the editor taking the document.
    const late = diff(used, loaded.before);
    o.carry = pending;
    o.shown = loaded.doc;
    o.mine = loaded.doc;
    o.base = theirs;
    o.rev = rev;
    if (isEmpty(late)) break;
    o.carry = [...pending, late];
  }
  if (clashes.length > 0) notice(S.clashes(clashes.length));
  if (o.carry.length > 0) {
    setSync("merged", "busy");
    await save(o);
  } else {
    setSync("theirs", "busy");
    setTimeout(() => open === o && unsaved(o).length === 0 && setSync("synced"), 2500);
  }
  renderContext();
  void refreshDecks();
}

async function fileChanged(o) {
  const res = await api(`/decks/${o.id}`).catch(() => null);
  if (res === null || open !== o) return;
  if (res.status === 404) {
    deckGone(o);
    return;
  }
  if (!res.ok) return;
  const current = await res.json();
  if (o.gone) {
    // The file is back: the deck is in step with it again from here.
    o.gone = false;
    $("notice").hidden = true;
  }
  await inTurn(o, () => takeTheirs(o, current.rev, current.text));
}

/**
 * The open deck's file was removed (the Agent deleted it, or another page did). The editor keeps
 * what the person sees and saves nothing more; they can keep it as a new deck.
 */
function deckGone(o) {
  if (open !== o || o.gone) return;
  o.gone = true;
  clearTimeout(o.timer);
  setSync("");
  notice(S.gone, 0, {
    label: S.keepCopy,
    run: () => void createDeck(o.mine?.title || S.untitled, o.mine ?? o.base),
  });
}

// ---- decks --------------------------------------------------------------------------------

async function openDeck(id) {
  const current = await getJson(`/decks/${id}`);
  let doc;
  try {
    doc = parseDeck(current.text);
  } catch (err) {
    notice(S.badFile(err instanceof Error ? err.message : String(err)));
    return;
  }
  stopFollowing();
  open = {
    id,
    token: crypto.randomUUID(),
    /** The file's revision the editor is in step with, and its document. */
    rev: current.rev,
    base: doc,
    /** The editor's document when it was last in step with the file; and now. */
    shown: doc,
    mine: doc,
    /** Edits already in the editor that no save has put in the file. */
    carry: [],
    ready: false,
    /** The file was removed under the editor: nothing is saved until it is back. */
    gone: false,
    timer: null,
    turn: Promise.resolve(),
  };
  cursor = { index: 0, slideId: null, selection: [] };
  setView("deck");
  setSync("");
  $("deck-title").textContent = doc.title || S.untitled;
  frame.srcdoc = editorHtml(doc, open.token);
  try {
    localStorage.setItem(`${location.pathname}#deck`, id);
  } catch {
    // Remembering the last deck is a convenience.
  }
  renderContext();
  await refreshDecks();
  await refreshTalk();
}

async function createDeck(title, doc) {
  const res = await send("/decks", "POST", { id: title, text: formatDeck(doc) });
  if (!res.ok) throw new Error(`${res.status}`);
  const { id } = await res.json();
  await openDeck(id);
  return id;
}

const blankDeck = (title) => ({
  format: "bento/slides",
  version: 1,
  title,
  size: { width: 1280, height: 720 },
  theme: {
    background: "#FFFFFF",
    color: "#141310",
    accent: "#E8442E",
    fontFamily: "system-ui, sans-serif",
  },
  slides: [
    {
      id: "s1",
      background: "#FFFFFF",
      transition: "none",
      notes: "",
      elements: [
        {
          id: "title",
          type: "text",
          role: "title",
          x: 96,
          y: 260,
          w: 1088,
          h: 160,
          rotation: 0,
          opacity: 1,
          html: title,
          fontSize: 72,
          fontFamily: "system-ui, sans-serif",
          fontWeight: 800,
          color: "#141310",
          align: "left",
          valign: "top",
          lineHeight: 1.1,
        },
      ],
    },
  ],
});

async function importFile(file) {
  try {
    const text = await file.text();
    const doc = /\.json$/i.test(file.name) ? parseDeck(text) : deckFromHtml(text);
    await createDeck(doc.title || file.name.replace(/\.(bento\.)?(html|json)$/i, ""), doc);
  } catch (err) {
    notice(S.importFailed(err instanceof Error ? err.message : String(err)));
  }
}

async function exportDeck() {
  if (open === null) return;
  const doc = open.mine ?? open.base;
  const name = `${(doc.title || "deck").replace(/[\\/:*?"<>|]+/g, " ").trim() || "deck"}.bento.html`;
  const res = await api(`/export?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: htmlWithDeck(runtime, doc),
  });
  if (!res.ok) return;
  const link = document.createElement("a");
  link.href = `../api/${(await res.json()).href}`;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

// ---- history and deletion -----------------------------------------------------------------

const when = (ms) =>
  new Date(ms).toLocaleString(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

async function showHistory() {
  const menu = $("history-menu");
  if (!menu.hidden || open === null) {
    closeMenus();
    return;
  }
  closeMenus();
  let versions = [];
  try {
    versions = (await getJson(`/decks/${open.id}/history`)).versions;
  } catch {
    versions = [];
  }
  const rows = versions.map((version) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.dataset.version = version.name;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = S.versionBy[version.by] ?? version.by;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = when(version.at);
    item.append(name, meta);
    return item;
  });
  if (rows.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = S.historyEmpty;
    rows.push(item);
  }
  menu.replaceChildren(...rows);
  menu.hidden = false;
  $("history").setAttribute("aria-expanded", "true");
}

/**
 * Puts an earlier version in the editor as the person's own edit: it is saved like one (the
 * Agent's later changes are replayed on it the usual way), and Bento's undo takes it back.
 */
async function restore(o, name) {
  let doc;
  try {
    doc = parseDeck((await getJson(`/decks/${o.id}/history/${encodeURIComponent(name)}`)).text);
  } catch (err) {
    notice(S.restoreFailed(err instanceof Error ? err.message : String(err)));
    return;
  }
  const taken = await inTurn(o, async () => {
    if (open !== o) return false;
    const loaded = await loadIntoEditor(o, doc);
    if (open !== o) return false;
    o.mine = loaded.doc;
    return true;
  }).catch(() => false);
  if (taken) scheduleSave(o);
}

/** Closes the open deck: the editor goes blank and nothing of it is saved any more. */
function closeDeck() {
  if (open === null) return;
  clearTimeout(open.timer);
  open.gone = true;
  open = null;
  stopFollowing();
  frame.srcdoc = "";
}

async function deleteDeck(id) {
  const wasOpen = open?.id === id;
  if (wasOpen) closeDeck();
  const res = await api(`/decks/${id}`, { method: "DELETE" }).catch(() => null);
  if (res === null || !res.ok) {
    notice(S.deleteFailed(res === null ? "offline" : String(res.status)));
    if (wasOpen) await openDeck(id);
    return;
  }
  await refreshDecks();
  if (open === null) {
    if (decks.length > 0) await openDeck(decks[0].id);
    else setView("start");
  }
}

function closeMenus() {
  arm(null);
  for (const [menu, button] of [
    ["deck-menu", "deck-button"],
    ["history-menu", "history"],
  ]) {
    $(menu).hidden = true;
    $(button).setAttribute("aria-expanded", "false");
  }
}

// ---- asking the Agent ---------------------------------------------------------------------

let sdk; // undefined until tried, null when this server has none
let reader = null;
let live = emptyLive();
let talk = { sessionId: null, status: null, messages: [] };

async function loadSdk() {
  if (sdk !== undefined) return sdk;
  try {
    sdk = await import(SDK);
  } catch {
    sdk = null;
  }
  return sdk;
}

function stopFollowing() {
  reader?.close();
  reader = null;
  live = emptyLive();
}

function renderTalk() {
  const list = $("talk");
  const items = talk.messages.map((message) => {
    const item = document.createElement("li");
    item.className = message.role === "user" ? "me" : message.role === "error" ? "error" : "ai";
    item.textContent = message.text;
    return item;
  });
  const running = talk.status !== null && talk.status !== "idle";
  const draft = running ? draftOf(live) : "";
  if (draft !== "") {
    const item = document.createElement("li");
    item.className = "ai draft";
    item.textContent = draft;
    items.push(item);
  }
  if (items.length === 0) {
    const item = document.createElement("li");
    item.className = "hint";
    item.textContent = S.hintEmpty;
    items.push(item);
  }
  list.replaceChildren(...items);
  list.scrollTop = list.scrollHeight;
  $("activity").textContent = running ? S.activity[live.activity ?? "thinking"] : "";
  $("stop").hidden = !running || !sdk;
  $("send").disabled = false;
}

async function follow(sessionId) {
  stopFollowing();
  if (!(await loadSdk()) || open === null) return;
  const mine = (reader = sdk.followSession(sessionId, { tailLimit: 1 }));
  mine.on("event", ({ record }) => {
    if (reader !== mine) return;
    const was = live.running;
    live = foldLive(live, record);
    if (was !== false && live.running === false) setTimeout(() => void refreshTalk(), 300);
    renderTalk();
  });
  mine.on("reset", () => {
    if (reader === mine) live = emptyLive();
  });
  mine.on("error", () => {
    if (reader === mine) reader = null;
  });
}

let talkTimer = null;
async function refreshTalk() {
  clearTimeout(talkTimer);
  if (open === null) return;
  const id = open.id;
  let next;
  try {
    next = await getJson(`/ask?deck=${encodeURIComponent(id)}`);
  } catch {
    return;
  }
  if (open?.id !== id) return;
  talk = next;
  const running = talk.status !== null && talk.status !== "idle";
  if (running && reader === null && talk.sessionId !== null) void follow(talk.sessionId);
  if (!running) stopFollowing();
  // The stream says when a task ends; this is for a server without it, and for a missed end.
  if (running) talkTimer = setTimeout(() => void refreshTalk(), 4000);
  renderTalk();
}

async function ask(text) {
  if (open === null || text.trim() === "") return;
  const o = open;
  // What the person just did reaches the file before the Agent reads it.
  clearTimeout(o.timer);
  await inTurn(o, () => save(o));
  talk.messages = [...talk.messages, { role: "user", text: text.trim() }];
  talk.status = "running";
  live = { ...emptyLive(), running: true };
  renderTalk();
  let res;
  try {
    res = await send("/ask", "POST", {
      deck: o.id,
      text,
      slide: cursor.slideId === null ? null : { id: cursor.slideId, number: cursor.index + 1 },
      selection: cursor.selection,
    });
  } catch (err) {
    res = { ok: false, status: String(err) };
  }
  if (!res.ok) {
    const detail = res.json
      ? ((await res.json().catch(() => null))?.error ?? res.status)
      : res.status;
    talk.messages = [...talk.messages, { role: "error", text: S.askFailed(String(detail)) }];
    talk.status = "idle";
    renderTalk();
    return;
  }
  const { sessionId } = await res.json();
  talk.sessionId = sessionId;
  await follow(sessionId);
  talkTimer = setTimeout(() => void refreshTalk(), 4000);
}

// ---- wiring -------------------------------------------------------------------------------

$("deck-button").onclick = () => {
  const show = $("deck-menu").hidden;
  closeMenus();
  if (!show) return;
  renderDeckMenu();
  $("deck-menu").hidden = false;
  $("deck-button").setAttribute("aria-expanded", "true");
};
$("deck-menu").onclick = (event) => {
  // The menu handles its own clicks: re-rendering a row detaches the clicked node, which the
  // outside-click handler would read as a click outside the menu.
  event.stopPropagation();
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    const id = remove.dataset.delete;
    if (armed === id) {
      closeMenus();
      void deleteDeck(id);
      return;
    }
    arm(id);
    renderDeckMenu();
    return;
  }
  const id = event.target.closest("li")?.dataset.id;
  closeMenus();
  if (id && id !== open?.id) void openDeck(id);
};
$("history").onclick = () => void showHistory();
$("history-menu").onclick = (event) => {
  const name = event.target.closest("li")?.dataset.version;
  if (!name) return;
  closeMenus();
  if (open !== null) void restore(open, name);
};
document.addEventListener("click", (event) => {
  if (!event.target.closest(".deck-pick, .history-pick")) closeMenus();
});
$("new").onclick = () => void createDeck(S.untitled, blankDeck(S.untitled));
$("import").onclick = $("start-import").onclick = () => $("file").click();
$("file").onchange = () => {
  const [file] = $("file").files;
  $("file").value = "";
  if (file) void importFile(file);
};
$("export").onclick = () => void exportDeck();
$("rail-toggle").onclick = () => {
  const off = app.dataset.rail !== "off";
  app.dataset.rail = off ? "off" : "on";
  $("rail-toggle").setAttribute("aria-pressed", String(!off));
};
$("ask").onsubmit = (event) => {
  event.preventDefault();
  const text = $("prompt").value;
  $("prompt").value = "";
  void ask(text);
};
$("prompt").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("ask").requestSubmit();
  }
};
$("stop").onclick = () => talk.sessionId && sdk && void sdk.abortSession(talk.sessionId);
$("rail-reset").onclick = async () => {
  if (open === null) return;
  await send("/ask/reset", "POST", { deck: open.id });
  await refreshTalk();
};
$("start-sample").onclick = async () => {
  const doc = parseDeck(await (await fetch("sample.bento.json")).text());
  await createDeck(doc.title, doc);
};
$("start-blank").onclick = () => void createDeck(S.untitled, blankDeck(S.untitled));
$("start-ask").onsubmit = async (event) => {
  event.preventDefault();
  const text = $("start-prompt").value.trim();
  if (text === "") return;
  const title = text.split(/[\n。.!?！？]/)[0].slice(0, 40) || S.untitled;
  await createDeck(title, blankDeck(title));
  await ask(text);
};

function listen() {
  const events = new EventSource("../api/events");
  let lost = false;
  events.onerror = () => {
    lost = true;
  };
  events.onopen = () => {
    if (!lost) return;
    lost = false;
    // What changed while the stream was down was never announced: look again.
    void refreshDecks();
    if (open !== null) void fileChanged(open);
  };
  events.addEventListener("decks", (event) => {
    const { changed, removed } = JSON.parse(event.data);
    void refreshDecks();
    if (open === null) return;
    if (removed.includes(open.id)) deckGone(open);
    else if (changed.includes(open.id)) void fileChanged(open);
  });
}

async function start() {
  const info = await getJson("/info").catch(() => ({ supported: false }));
  if (!info.supported) {
    setView("unsupported");
    return;
  }
  runtime = await (await fetch(RUNTIME)).text();
  await refreshDecks();
  listen();
  let last = null;
  try {
    last = localStorage.getItem(`${location.pathname}#deck`);
  } catch {
    last = null;
  }
  const first = decks.find((deck) => deck.id === last) ?? decks[0];
  if (first) await openDeck(first.id);
  else setView("start");
}

void start();

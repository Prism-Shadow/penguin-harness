// The Slides page: a deck picker, the Bento editor in a sandboxed frame, and a rail that asks
// the Agent to change the open deck.
//
// One deck is one file the handler serves. The page keeps the editor and the file in step:
//   - the person edits   -> the frame reports the document -> saved to the file;
//   - the Agent edits    -> the handler's stream says the file changed -> loaded into the editor,
//     with whatever the person did meanwhile replayed on top (./sync.js).
// The editor never talks to anything but this page: its frame has no origin of its own and a
// policy that allows no connection, so the Bento runtime cannot reach the network or the app.
import { exportPowerPoint } from "./powerpoint.js";
import { deckFiles } from "./deck-files.js";
import { bridge, connectSave, captureSave, editorToken } from "./bridge.js";
import { newConversation, readConversation } from "./conversation.js";
import { showConversation } from "./conversation-view.js";
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
frame.title = S.frameTitle;
frame.parentElement.setAttribute("aria-label", S.frameTitle);
$("player-frame").title = S.present;
$("player").setAttribute("aria-label", S.present);
$("rail-toggle").setAttribute("aria-controls", "rail");
app.dataset.rail = matchMedia("(max-width: 850px)").matches ? "off" : "on";
$("rail-toggle").setAttribute("aria-pressed", String(app.dataset.rail === "on"));
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

let listRequest = 0;
let connected = false;
const filesPage = deckFiles({
  onOpen: (id) => openDeck(id).catch(() => notice(filesPage.openFailed)),
  onRename: async (deck, title) => {
    const current = await getJson(`/decks/${deck.id}`);
    const doc = parseDeck(current.text);
    // Preserve concurrent edits and the file's identity, its history, and its linked conversation.
    if ((doc.title?.trim() || deck.id) !== deck.title.trim())
      throw Object.assign(new Error(), { status: 409 });
    doc.title = title;
    const response = await send(`/decks/${deck.id}`, "PUT", {
      text: formatDeck(doc),
      base: current.rev,
    });
    if (!response.ok)
      throw Object.assign(new Error(String(response.status)), { status: response.status });
    await refreshDecks();
  },
  onDelete: (id) => removeFile(id),
  onRefresh: () => (connected ? refreshDecks() : start()),
  onBack: () => showFiles().catch(() => notice(S.transferFailed)),
});

async function refreshDecks() {
  const request = ++listRequest;
  try {
    const result = await getJson("/decks");
    if (request !== listRequest) return;
    decks = result.decks;
  } catch {
    if (request === listRequest) filesPage.render(decks, "error");
    return;
  }
  filesPage.render(decks, "ready");
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
function frameHead(token) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`;
  return (
    policy +
    `<script>(${connectSave.toString()})(${JSON.stringify(token)},(${captureSave.toString()}),${JSON.stringify(S.saveDeck)})</` +
    "script>"
  );
}

function editorHtml(doc, token) {
  const script =
    `<script>(${bridge.toString()})(${JSON.stringify(token)},${JSON.stringify(locale === "zh" ? "zh-Hans" : "en")})</` +
    "script>";
  return htmlWithDeck(runtime, doc)
    .replace(/<head>/i, () => `<head>${frameHead(token)}`)
    .replace(/<\/body>/i, `${script}</body>`);
}

let loads = 0;
const waiting = new Map();
/** Hands the editor a document; resolves with what it held just before and what it shows now. */
function loadIntoEditor(o, doc) {
  return frameRequest(o, { type: "load", json: JSON.stringify(doc) });
}

function frameRequest(o, request) {
  const id = ++loads;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(S.transferFailed));
    }, LOAD_TIMEOUT_MS);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    frame.contentWindow.postMessage({ [TAG]: 1, token: o.token, id, ...request }, "*");
  });
}

async function currentDocument(o) {
  return o.ready ? (await frameRequest(o, { type: "read" })).doc : o.mine;
}

async function savedSnapshot(o) {
  return inTurn(o, async () => {
    if (open !== o || !o.ready || o.gone) throw new Error(o.gone ? S.gone : S.transferFailed);
    const doc = await currentDocument(o);
    if (open !== o) throw new Error(S.transferFailed);
    o.mine = doc;
    clearTimeout(o.timer);
    await save(o, true);
    if (open !== o || o.gone || unsaved(o).length) throw new Error(S.notSaved);
    return o.mine;
  });
}

async function saveCurrent() {
  if (!open) return;
  try {
    await savedSnapshot(open);
  } catch (error) {
    setSync("notSaved", "attention");
    notice(S.saveFailed(error.message));
  }
}
$("save").onclick = saveCurrent;
function saveKey(event) {
  if (open && app.dataset.view === "deck" && captureSave(event)) void saveCurrent();
}
window.addEventListener("keydown", saveKey, true);
// The App's own toolbar can hold focus while its workbench is open. Handle its shortcut
// only while this page is visible and the user is in this workbench's app or window.
try {
  const host = window.parent;
  if (host !== window) {
    const onHostKey = (event) => {
      if (!frameElement?.getClientRects().length) return;
      const win = frameElement.closest('[role="dialog"], section[aria-label]');
      if (host.location.pathname.startsWith("/app/") || (win && win.contains(event.target)))
        saveKey(event);
    };
    host.addEventListener("keydown", onHostKey, true);
    window.addEventListener(
      "pagehide",
      () => host.removeEventListener("keydown", onHostKey, true),
      { once: true },
    );
  }
} catch {
  /* The workbench can also run in a cross-origin host. */
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message[TAG] !== 1 || open === null || message.token !== open.token) return;
  if (
    message.type === "save" &&
    (event.source === frame.contentWindow ||
      ($("player").open && event.source === $("player-frame").contentWindow))
  ) {
    void saveCurrent();
    return;
  }
  if (event.source !== frame.contentWindow) return;
  if (message.type === "ready") {
    open.shown = message.doc;
    open.mine = message.doc;
    open.ready = true;
    frame.inert = false;
    setSync("synced");
    void refreshDecks();
  } else if (message.type === "changed") {
    open.mine = message.doc;
    scheduleSave(open);
  } else if (message.type === "loaded" || message.type === "read") {
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

async function save(o, explicit = false) {
  if (open !== o || !o.ready || o.gone) return;
  if (unsaved(o).length === 0) {
    setSync("synced");
    return;
  }
  const mine = o.mine;
  let res;
  try {
    res = await send(`/decks/${o.id}`, "PUT", { text: formatDeck(mine), base: o.rev });
  } catch (error) {
    setSync("offline", "attention");
    if (explicit) throw error;
    return;
  }
  if (res.status === 409) {
    const current = await res.json();
    await takeTheirs(o, current.rev, current.text, explicit);
    return;
  }
  if (res.status === 404) {
    deckGone(o);
    if (explicit) throw new Error(S.gone);
    return;
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const why = detail?.error?.message || detail?.error || `HTTP ${res.status}`;
    setSync("notSaved", "attention");
    if (explicit) throw new Error(String(why));
    notice(S.saveFailed(why));
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
async function takeTheirs(o, rev, text, explicit = false) {
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
    await save(o, explicit);
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

let opening = 0;
async function openDeck(id) {
  const next = ++opening;
  const previous = open;
  if (previous?.ready && !previous.gone) {
    const latest = await currentDocument(previous);
    if (next !== opening) return;
    previous.mine = latest;
    clearTimeout(previous.timer);
    await inTurn(previous, () => save(previous));
    if (next !== opening || unsaved(previous).length) return;
  }
  const current = await getJson(`/decks/${id}`);
  if (runtime === null) {
    const response = await fetch(RUNTIME);
    if (!response.ok) throw new Error(String(response.status));
    runtime = await response.text();
  }
  if (next !== opening) return;
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
    token: editorToken(),
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
  setSync("opening");
  $("deck-title").textContent = doc.title || S.untitled;
  frame.inert = true;
  frame.srcdoc = editorHtml(doc, open.token);
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
          html: title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
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
  const doc = await savedSnapshot(open);
  await downloadDeck(doc.title, "bento.html", htmlWithDeck(runtime, doc));
}

async function downloadDeck(title, suffix, bytes) {
  const name = `${(title || "deck").replace(/[\\/:*?"<>|]+/g, " ").trim() || "deck"}.${suffix}`;
  const res = await api(`/export?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) throw new Error(S.transferFailed);
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

async function showFiles() {
  const next = ++opening;
  const previous = open;
  if (previous?.ready) {
    if (!previous.gone) await savedSnapshot(previous);
    if (next !== opening || unsaved(previous).length) return;
  }
  closeMenus();
  closeDeck();
  setView("start");
  $("start-blank").focus();
  await refreshDecks();
}

async function removeFile(id) {
  const res = await api(`/decks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(String(res.status));
  await refreshDecks();
}

async function deleteDeck(id) {
  const wasOpen = open?.id === id;
  if (wasOpen) closeDeck();
  try {
    await removeFile(id);
    if (!open) setView("start");
  } catch (error) {
    notice(S.deleteFailed(error.message || "offline"));
    if (wasOpen) await openDeck(id);
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
let transcript = newConversation();
let followedId = null;
let renderFrame = null;
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
  followedId = null;
  transcript = newConversation();
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
}

function renderTalk() {
  const running = talk.status !== null && talk.status !== "idle";
  showConversation($("talk"), talk.messages, transcript, {
    locale,
    running,
    hint: S.hintEmpty,
    retry: ask,
  });
  $("stop").hidden = !running || !sdk;
}

function scheduleTalk() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderTalk();
  });
}

async function follow(sessionId) {
  if (followedId === sessionId && reader !== null) return;
  stopFollowing();
  const deck = open;
  followedId = sessionId;
  if (!(await loadSdk()) || !deck || open !== deck || followedId !== sessionId) return;
  // The rail retains 40 messages. The SDK window counts whole Tasks, not
  // records, so even a long tool run is restored with its own original turn.
  const mine = (reader = sdk.followSession(sessionId, { tailLimit: 40 }));
  mine.on("event", ({ record }) => {
    if (reader !== mine) return;
    readConversation(transcript, record);
    if (record.payload?.type === "task_end" && talk.status !== "idle") {
      clearTimeout(talkTimer);
      talkTimer = setTimeout(() => void refreshTalk(), 150);
    }
    scheduleTalk();
  });
  mine.on("reset", () => {
    if (reader === mine) {
      transcript = newConversation();
      scheduleTalk();
    }
  });
  mine.on("error", () => {
    if (reader === mine) reader = null;
  });
}

let talkTimer = null;
let talkRevision = 0;
async function refreshTalk() {
  clearTimeout(talkTimer);
  if (open === null) return;
  const deck = open;
  const id = deck.id;
  const revision = ++talkRevision;
  let next;
  try {
    next = await getJson(`/ask?deck=${encodeURIComponent(id)}`);
  } catch {
    return;
  }
  if (open !== deck || talkRevision !== revision) return;
  talk = next;
  const running = talk.status !== null && talk.status !== "idle";
  if (talk.sessionId !== null && (followedId !== talk.sessionId || reader === null))
    void follow(talk.sessionId);
  if (talk.sessionId === null) stopFollowing();
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
  if (open !== o) return;
  ++talkRevision;
  talk.messages = [
    ...talk.messages,
    { role: "user", text: text.trim(), at: new Date().toISOString() },
  ];
  talk.status = "running";

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
  if (open !== o) return;
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
  ++talkRevision;
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
function newPresentation() {
  $("create-name").value = S.untitled;
  $("create-layout").value = "blank";
  $("create-dialog").showModal();
  $("create-name").select();
}
$("new").onclick = newPresentation;
$("create-cancel").onclick = () => $("create-dialog").close();
$("create-form").onsubmit = async (event) => {
  event.preventDefault();
  const name = $("create-name").value.trim();
  if (!name) return $("create-name").focus();
  const doc = blankDeck(name);
  if ($("create-layout").value === "brief") {
    for (const [heading, body] of S.brief) {
      const slide = blankDeck(heading).slides[0];
      slide.id = "s" + (doc.slides.length + 1);
      slide.elements[0].y = 96;
      slide.elements.push({
        ...slide.elements[0],
        id: "body",
        role: "body",
        y: 320,
        h: 220,
        html: body,
        fontSize: 42,
        fontWeight: 400,
      });
      doc.slides.push(slide);
    }
  }
  const submit = $("create-form").querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await createDeck(name, doc);
    $("create-dialog").close();
  } catch {
    $("create-dialog").close();
    notice(S.transferFailed);
  } finally {
    submit.disabled = false;
  }
};
$("present").onclick = async () => {
  if (!open) return;
  try {
    const doc = await savedSnapshot(open);
    $("player-title").textContent = doc.title;
    const launch =
      '<script>const start=()=>{const go=document.querySelector(".ed-playgo");if(go){loaded.disconnect();go.click();}};const loaded=new MutationObserver(start);loaded.observe(document.body,{childList:true,subtree:true});start();</' +
      "script>";
    $("player-frame").srcdoc = htmlWithDeck(runtime, { ...doc, readonly: true })
      .replace(/<head>/i, () => `<head>${frameHead(open.token)}`)
      .replace(/<\/body>/i, launch + "</body>");
    $("player").showModal();
    $("player-frame").focus();
  } catch {
    notice(S.transferFailed);
  }
};
$("player-close").onclick = () => $("player").close();
$("player").onclose = () => {
  $("player-frame").removeAttribute("srcdoc");
};
$("import").onclick = $("start-import").onclick = () => $("file").click();
$("file").onchange = () => {
  const [file] = $("file").files;
  $("file").value = "";
  if (file) void importFile(file);
};
$("pptx").onclick = async () => {
  if (!open) return;
  $("pptx").disabled = true;
  try {
    const doc = await savedSnapshot(open);
    await downloadDeck(doc.title, "pptx", await exportPowerPoint(doc));
  } catch (e) {
    notice(e.message === "unsupportedPowerPoint" ? S.unsupportedPowerPoint : S.transferFailed);
  } finally {
    $("pptx").disabled = false;
  }
};
$("export").onclick = () => void exportDeck().catch(() => notice(S.transferFailed));
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
  ++talkRevision;
  await send("/ask/reset", "POST", { deck: open.id });
  await refreshTalk();
};
$("start-sample").onclick = async () => {
  const doc = parseDeck(await (await fetch("sample.bento.json")).text());
  if (locale === "zh") {
    doc.title = "用四页了解 PenguinHarness";
    const [cover, overview, chart, start] = doc.slides;
    cover.notes = "读出标题，给观众一点时间思考。";
    cover.elements.find((e) => e.id === "headline").html = "越用越懂你工作的智能体";
    overview.notes = "用三句话概括智能体能做什么。";
    const labels = {
      headline: "它能做什么",
      "card-1-title": "动手执行",
      "card-1-body": "在你的工作区里，使用你选择的工具、技能和沙盒完成任务。",
      "card-2-title": "记住经验",
      "card-2-body": "在智能体状态中保留技能、记忆和应用，下次继续用。",
      "card-3-title": "积累改进",
      "card-3-body": "在基准测试上验证每次调整，只保留得分更高的改动。",
    };
    for (const element of overview.elements)
      if (labels[element.id]) element.html = labels[element.id];
    chart.notes = "图中是示例分数，可以请智能体换成自己的数据。";
    chart.elements.find((e) => e.id === "headline").html = "每轮改进的得分";
    const option = chart.elements.find((e) => e.id === "chart").option;
    option.xAxis.data = ["第 0 轮", "第 1 轮", "第 2 轮", "第 3 轮"];
    option.series[0].name = "示例得分";
    start.notes = "最后介绍上手的三个步骤。";
    const steps = [
      "开始使用",
      "<b>1.</b> 安装桌面应用或命令行工具。",
      "<b>2.</b> 添加模型，开始一次对话。",
      "<b>3.</b> 从插件市场安装你需要的工具。",
    ];
    start.elements
      .filter((e) => e.type === "text")
      .forEach((e, index) => {
        e.html = steps[index];
      });
  }
  await createDeck(doc.title, doc);
};
$("start-blank").onclick = newPresentation;
$("start-ask").onsubmit = async (event) => {
  event.preventDefault();
  const text = $("start-prompt").value.trim();
  if (text === "") return;
  const title = text.split(/[\n。.!?！？]/)[0].slice(0, 40) || S.untitled;
  await createDeck(title, blankDeck(title));
  await ask(text);
};

function listen() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && app.dataset.view === "start") void refreshDecks();
  });
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
  setView("start");
  filesPage.render(decks, "loading");
  try {
    const info = await getJson("/info");
    if (!info.supported) {
      setView("unsupported");
      return;
    }
    connected = true;
    listen();
    await refreshDecks();
  } catch {
    filesPage.render(decks, "error");
  }
}

void start();

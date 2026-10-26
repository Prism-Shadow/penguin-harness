import dictionaries from "./strings.js";
import { draftOf, emptyLive, foldLive } from "./live.js";

const $ = (id) => document.getElementById(id);
const dialog = $("dialog");
const drafts = new Map();
// The page SDK the server serves beside this workbench; an older server has none, and then the
// page polls. Imported only when a question is followed, by a name in a variable so that no
// tool tries to resolve the file ahead of time.
const SDK = "../sdk/workbench.js";
// The open question is followed live and refreshes the page the moment its task ends, so the
// list can be polled slowly; without the page SDK it is polled at the old pace.
const POLL_MS = 5000;
const FALLBACK_POLL_MS = 2500;
// The answer is saved a moment after the task ends: look again a few times before giving up.
const SETTLE_RETRY_MS = [0, 400, 1200, 2500];
// A status's colour: running shares success with answered, its word tells them apart.
const TONES = {
  open: "attention",
  running: "success",
  answered: "success",
  resolved: "done",
  failed: "danger",
};
let preferred;
try {
  preferred = localStorage.getItem("penguin.support.lang") || localStorage.getItem("penguin.lang");
} catch {}
let language =
  preferred === "en" || preferred === "zh"
    ? preferred
    : navigator.language.startsWith("zh")
      ? "zh"
      : "en";
let copy = dictionaries[language];
let tickets = [];
let selected = null;
let busy = false;
let loaded = false;
let requestVersion = 0;
let listSignature = "";
let detailSignature = "";
let sdk; // undefined until tried, null when it cannot be loaded
let sdkLoad = null;
let live = null; // the open question's reader: { id, sessionId, reader, view, settling }
let stopping = null; // null, "ask" or "stopping"
let liveQueued = false;
let shownDraft = "";
let pollTimer;

async function api(route, body) {
  const response = await fetch(
    "../api" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new Error(copy.connectionError(response.status));
  }
  if (!response.ok) throw new Error(data.error?.message || data.error || copy.error);
  return data;
}

function report(id, error) {
  $(id).textContent = error.message || copy.error;
  $(id).hidden = false;
}

// A question someone stopped says so in plain words rather than in the server's error.
const errorText = (ticket) => (ticket.stopped ? copy.stopped : ticket.error);

function badge(element, status) {
  element.textContent = copy[status] || status;
  element.dataset.tone = TONES[status] || "neutral";
}

function translate() {
  copy = dictionaries[language];
  document.documentElement.lang = language;
  document.title = copy.title;
  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.textContent = copy[el.dataset.copy];
  });
  for (const [id, key] of [
    ["search", "search"],
    ["filter", "status"],
    ["locale", "language"],
    ["close", "close"],
    ["list", "questions"],
  ]) {
    $(id).setAttribute("aria-label", copy[key]);
  }
  $("search").placeholder = copy.search;
  $("locale").value = language;
  if (selected === null) $("dialog-title").textContent = copy.newTicket;
  render();
}

function renderList() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const visible = tickets.filter((ticket) => {
    const matchesStatus = filter === "all" || ticket.status === filter;
    const text = ticket.title + " " + ticket.messages.map((message) => message.text).join(" ");
    return matchesStatus && text.toLowerCase().includes(query);
  });
  // Polling must not replace a focused row when its visible content has not changed.
  const signature = JSON.stringify([
    language,
    loaded,
    query,
    filter,
    visible.map(({ id, title, status, updatedAt }) => [id, title, status, updatedAt]),
  ]);
  if (signature === listSignature) return;
  listSignature = signature;
  const rows = visible.map((ticket) => {
    const row = document.createElement("li");
    const button = document.createElement("button");
    const summary = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const status = document.createElement("span");
    const time = document.createElement("time");
    title.textContent = ticket.title || copy.newTicket;
    meta.className = "meta";
    status.className = "wb-badge";
    badge(status, ticket.status);
    meta.append(status);
    if (ticket.status === "running") {
      const estimate = document.createElement("small");
      estimate.dataset.waiting = ticket.id;
      meta.append(estimate);
    }
    time.dateTime = ticket.updatedAt;
    time.textContent = new Date(ticket.updatedAt).toLocaleDateString(language);
    button.dataset.ticket = ticket.id;
    button.onclick = () => showTicket(ticket.id);
    summary.append(title, meta);
    button.append(summary, time);
    row.append(button);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "empty wb-muted";
    empty.textContent = !loaded
      ? copy.loading
      : query || filter !== "all"
        ? copy.noMatches
        : copy.empty;
    rows.push(empty);
  }
  $("list").replaceChildren(...rows);
}

// Build answer markup with DOM nodes, never with model-generated HTML.
function inline(parent, text) {
  let offset = 0;
  const pattern =
    /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>"\x60]+)|\x60([^\x60]+)\x60|\*\*([^*]+)\*\*/g;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    let element;
    if (match[2] || match[3]) {
      element = document.createElement("a");
      element.href = (match[2] || match[3]).replace(/[.,;:!?，。；！？）)]+$/, "");
      const citation = /^\d+$/.test(match[1] || "");
      element.textContent = citation ? `[${match[1]}]` : match[1] || element.href;
      if (citation) element.className = "citation";
      element.target = "_blank";
      element.rel = "noreferrer";
    } else {
      element = document.createElement(match[4] ? "code" : "strong");
      element.textContent = match[4] || match[5];
    }
    parent.append(element);
    offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}

function answerNode(text) {
  const box = document.createElement("div");
  let list = null;
  let code = null;
  for (const line of text.split("\n")) {
    if (/^\x60{3}/.test(line)) {
      if (code) code = null;
      else {
        const pre = document.createElement("pre");
        code = document.createElement("code");
        pre.append(code);
        box.append(pre);
      }
      list = null;
      continue;
    }
    if (code) {
      code.textContent += line + "\n";
      continue;
    }
    if (!line.trim()) {
      list = null;
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      const tag = bullet[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        box.append(list);
      }
      const item = document.createElement("li");
      if (!bullet[1]) item.value = Number(/^\s*(\d+)/.exec(line)[1]);
      inline(item, bullet[2]);
      list.append(item);
    } else {
      list = null;
      const element = document.createElement(
        heading ? "h" + Math.min(heading[1].length + 2, 6) : "p",
      );
      inline(element, heading ? heading[2] : line);
      box.append(element);
    }
  }
  return box;
}

function renderTicket() {
  const ticket = tickets.find((item) => item.id === selected);
  if (!ticket) return;
  const signature = JSON.stringify([language, ticket]);
  if (signature !== detailSignature) {
    detailSignature = signature;
    $("dialog-title").textContent = ticket.title || copy.newTicket;
    badge($("status"), ticket.status);
    const messages = ticket.messages.map((message) => {
      const article = document.createElement("article");
      const heading = document.createElement("h3");
      article.className = "answer";
      heading.textContent =
        (message.role === "user" ? copy.question : copy.title) +
        " · " +
        new Date(message.at).toLocaleString(language);
      article.append(heading, answerNode(message.text));
      return article;
    });
    $("messages").replaceChildren(...messages);
    const error = errorText(ticket);
    $("dialog-error").hidden = !error;
    if (error) report("dialog-error", new Error(error));
  }
  const disabled = busy || ticket.status === "running";
  $("resolve").textContent = ticket.status === "resolved" ? copy.reopen : copy.resolve;
  $("resolve").disabled = disabled;
  $("retry").hidden = ticket.status !== "failed";
  $("retry").disabled = disabled;
  $("followup").hidden = ticket.status === "resolved";
  $("followup")
    .querySelectorAll("textarea, button")
    .forEach((el) => (el.disabled = disabled));
}

// A rough two-minute budget, not a completion promise. Once exceeded, show elapsed time
// and say the lookup is taking longer; never reset the countdown or claim an answer is ready.
function waitingText(ticket) {
  const start = Date.parse(ticket.updatedAt || ticket.createdAt);
  const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const remaining = Math.ceil((120 - seconds) / 60);
  return {
    estimate: remaining > 0 ? copy.estimate(remaining) : copy.takingLonger,
    elapsed: copy.elapsed(elapsed),
  };
}

function updateWaiting() {
  $("list")
    .querySelectorAll("[data-waiting]")
    .forEach((element) => {
      const ticket = tickets.find((item) => item.id === element.dataset.waiting);
      if (!ticket) return;
      const text = waitingText(ticket).estimate;
      if (element.textContent !== text) element.textContent = text;
    });
  const ticket = tickets.find((item) => item.id === selected);
  $("waiting").hidden = ticket?.status !== "running";
  if (ticket?.status === "running") {
    const timing = waitingText(ticket);
    $("waiting").textContent = `${timing.elapsed} · ${timing.estimate}`;
  }
}

// Following the open question live: one reader, only while its dialog is open on a question
// being researched and the page is shown. Everything else, and every server without the page
// SDK, is polling.
function loadSdk() {
  sdkLoad ??= import(SDK).then(
    (module) => (sdk = module),
    () => {
      sdk = null;
      schedulePoll();
    },
  );
  return sdkLoad;
}

function syncLive() {
  const ticket = tickets.find((item) => item.id === selected);
  const wanted =
    dialog.open && !document.hidden && ticket?.status === "running" && sdk !== null ? ticket : null;
  if (live && live.id === wanted?.id && live.sessionId === wanted.sessionId) return;
  if (live) {
    live.reader?.close();
    live = null;
    stopping = null;
  }
  if (!wanted) return;
  const current = {
    id: wanted.id,
    sessionId: wanted.sessionId,
    reader: null,
    view: emptyLive(),
    settling: false,
  };
  live = current;
  loadSdk().then(() => {
    if (live !== current) return;
    if (sdk) {
      try {
        // The latest task is enough: it holds the Request being written.
        current.reader = sdk.followSession(current.sessionId, { tailLimit: 1 });
        current.reader.on("event", ({ record }) => onRecord(current, record));
        current.reader.on("reset", () => {
          current.view = emptyLive();
          queueLive();
        });
        // Refused for good (the conversation is gone): polling carries on.
        current.reader.on("error", () => (current.reader = null));
      } catch {
        current.reader = null;
      }
    }
    renderLive();
  });
}

function onRecord(current, record) {
  if (live !== current) return;
  current.view = foldLive(current.view, record);
  if (!record.origin?.length && record.payload?.type === "task_end") settle(current);
  queueLive();
}

// The task ended: show the answer now instead of at the next poll.
async function settle(current) {
  if (current.settling) return;
  current.settling = true;
  try {
    for (const wait of SETTLE_RETRY_MS) {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (live !== current || current.view.running) return;
      await refresh();
      if (tickets.find((item) => item.id === current.id)?.status !== "running") return;
    }
  } finally {
    current.settling = false;
  }
}

function queueLive() {
  if (liveQueued) return;
  liveQueued = true;
  queueMicrotask(() => {
    liveQueued = false;
    renderLive();
  });
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function renderLive() {
  const ticket = tickets.find((item) => item.id === selected);
  const running = ticket?.status === "running";
  $("live").hidden = !running;
  $("stop").hidden = !running || !sdk || stopping !== null;
  $("stop-confirm").hidden = !running || stopping === null;
  $("stop-yes").disabled = $("stop-no").disabled = stopping === "stopping";
  setText($("stop-ask"), stopping === "stopping" ? copy.stopping : copy.stopAsk);
  setText($("live-heading"), `${copy.title} · ${copy.draft}`);
  const view = running && live?.reader ? live.view : emptyLive();
  const activity = view.running === false ? null : copy.activity[view.activity];
  setText($("activity"), activity || copy.working);
  const draft = draftOf(view);
  if (draft !== shownDraft) {
    shownDraft = draft;
    $("draft").replaceChildren(...(draft ? [answerNode(draft)] : []));
  }
}

function render() {
  renderList();
  $("new").disabled = busy;
  $("submit").disabled = busy;
  renderTicket();
  syncLive();
  renderLive();
  updateWaiting();
}

function openDialog() {
  $("dialog-error").hidden = true;
  if (!dialog.open) dialog.showModal();
}

function showTicket(id) {
  selected = id;
  detailSignature = "";
  $("create").hidden = true;
  $("ticket").hidden = false;
  $("followup").elements.text.value = drafts.get(id) || "";
  openDialog();
  renderTicket();
  syncLive();
  renderLive();
  updateWaiting();
  $("dialog-title").focus();
}

async function refresh() {
  const version = ++requestVersion;
  try {
    const data = await api("/tickets");
    if (version !== requestVersion) return;
    tickets = data.tickets;
    loaded = true;
    $("page-error").hidden = true;
    render();
  } catch (error) {
    if (version === requestVersion) report("page-error", error);
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, sdk === null ? FALLBACK_POLL_MS : POLL_MS);
}

async function poll() {
  if (!document.hidden && !busy) await refresh();
  schedulePoll();
}

async function mutate(action) {
  if (busy) return null;
  busy = true;
  requestVersion++;
  $("dialog-error").hidden = true;
  render();
  try {
    const ticket = await action();
    const index = tickets.findIndex((item) => item.id === ticket.id);
    if (index === -1) tickets.unshift(ticket);
    else tickets[index] = ticket;
    return ticket;
  } catch (error) {
    report(dialog.open ? "dialog-error" : "page-error", error);
    return null;
  } finally {
    busy = false;
    render();
  }
}

$("new").onclick = () => {
  selected = null;
  $("dialog-title").textContent = copy.newTicket;
  $("create").hidden = false;
  $("ticket").hidden = true;
  openDialog();
  $("create").elements.text.focus();
};
$("close").onclick = $("cancel").onclick = () => dialog.close();
const outsideDialog = (event) => {
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
};
let pressedBackdrop = false;
dialog.addEventListener("pointerdown", (event) => {
  pressedBackdrop = event.target === dialog && outsideDialog(event);
});
dialog.addEventListener("click", (event) => {
  if (pressedBackdrop && event.target === dialog && outsideDialog(event)) dialog.close();
  pressedBackdrop = false;
});
dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  dialog.close();
});
dialog.addEventListener("close", () => {
  syncLive();
  const row = [...$("list").querySelectorAll("button")].find(
    (button) => button.dataset.ticket === selected,
  );
  (row || $("new")).focus();
});
document.addEventListener("visibilitychange", render);
$("create").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  const ticket = await mutate(() => api("/tickets", body));
  if (!ticket) return;
  form.reset();
  if (dialog.open) showTicket(ticket.id);
};
$("followup").oninput = (event) => drafts.set(selected, event.currentTarget.elements.text.value);
$("followup").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = selected;
  const body = Object.fromEntries(new FormData(form));
  const ticket = await mutate(() => api("/tickets/" + id, body));
  if (ticket) {
    drafts.delete(id);
    form.reset();
  }
};
$("resolve").onclick = () => {
  const ticket = tickets.find((item) => item.id === selected);
  mutate(() =>
    api("/tickets/" + selected, {
      action: ticket.status === "resolved" ? "reopen" : "resolve",
    }),
  );
};
$("retry").onclick = () => mutate(() => api("/tickets/" + selected, { action: "retry" }));
$("stop").onclick = () => {
  stopping = "ask";
  renderLive();
  $("stop-no").focus();
};
$("stop-no").onclick = () => {
  stopping = null;
  renderLive();
  $("stop").focus();
};
$("stop-yes").onclick = async () => {
  const ticket = tickets.find((item) => item.id === selected);
  if (!sdk || ticket?.status !== "running") return;
  stopping = "stopping";
  renderLive();
  try {
    // Still "Stopping…" until the question shows as stopped; nothing to wait for when idle.
    if (!(await sdk.abortSession(ticket.sessionId))) stopping = null;
  } catch {
    stopping = null;
    report("dialog-error", new Error(copy.error));
  }
  await refresh();
};
$("search").oninput = $("filter").onchange = () => {
  renderList();
  updateWaiting();
};
$("locale").onchange = () => {
  language = $("locale").value;
  try {
    localStorage.setItem("penguin.support.lang", language);
  } catch {}
  translate();
};
translate();
refresh();
schedulePoll();
setInterval(() => {
  if (!document.hidden) updateWaiting();
}, 1000);

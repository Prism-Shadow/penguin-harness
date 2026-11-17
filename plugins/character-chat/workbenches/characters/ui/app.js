import { draftOf } from "./directives.js";
import { KINDS, MOODS, PARTS, lookOf, portrait } from "./rig.js";
import { SCENES, phaseOf, scene } from "./scenes.js";
import { STRINGS, deviceLanguage } from "./strings.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const ICONS = {
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M8 14v6",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1114 0z M14 10a2 2 0 11-4 0 2 2 0 014 0z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  reply: "M20 6v5a4 4 0 01-4 4H5m4-4-4 4 4 4",
  history:
    "M4 5.5h12A1.5 1.5 0 0 1 17.5 7v6A1.5 1.5 0 0 1 16 14.5H9.5L6 17.5v-3H4A1.5 1.5 0 0 1 2.5 13V7A1.5 1.5 0 0 1 4 5.5zM20 9.5v6a1.5 1.5 0 0 1-1.5 1.5H18v2.5L15 17",
  memory:
    "M6.5 4.5H17a1.5 1.5 0 0 1 1.5 1.5v13.5H7.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 1-2zM5.500 17.500a2 2 0 0 1 2-2h11M9.5 8.5h5.500M9.5 11.5h3.500",
  card: "M4.500 6h15A1.500 1.500 0 0 1 21 7.500v9a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 16.500v-9A1.500 1.500 0 0 1 4.500 6zM8.500 12.200a1.700 1.700 0 1 0 0-3.400 1.700 1.700 0 0 0 0 3.400zM5.800 15.500c.5-1.300 1.500-2 2.700-2s2.200.7 2.700 2M14 10h4M14 13.500h3",
  chapter:
    "M7 4.500h10A1.500 1.500 0 0 1 18.500 6v14L12 16l-6.500 4V6A1.500 1.500 0 0 1 7 4.500zM12 8v4.500M9.750 10.250h4.500",
  close: "M6.500 6.500l11 11M17.500 6.500l-11 11",
  plus: "M12 5.500v13M5.500 12h13",
  send: "M12 19V6M6.500 11.500L12 6l5.500 5.500",
  stop: "M7.500 7.500h9v9h-9z",
  aloud:
    "M4.500 10v4h3l4 3.500v-11L7.500 10zM15 9.500a3.500 3.500 0 0 1 0 5M17.500 7a7 7 0 0 1 0 10",
  forget: "M5.500 7.500h13M10 7.500V5.500h4v2M7.500 7.500l.800 11h7.400l.800-11",
  download: "M12 4.500v10M7.500 10.500L12 15l4.500-4.500M5 19.500h14",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
// The friendship mark grows a leaf a level: a seed, a sprout, two leaves, a bud, a flower.
const BOND_MARKS = [
  "M12 20v-3M9.500 17a2.500 2.500 0 0 1 5 0",
  "M12 20v-7M12 14c0-2.500 1.500-4 4-4 0 2.500-1.500 4-4 4z",
  "M12 20v-8M12 14c0-2.500 1.500-4 4-4 0 2.500-1.500 4-4 4zM12 16c0-2.500-1.500-4-4-4 0 2.500 1.500 4 4 4z",
  "M12 20v-8M12 15c0-2 1.300-3.300 3.500-3.300 0 2-1.300 3.300-3.500 3.300zM12 17c0-2-1.300-3.300-3.500-3.300 0 2 1.300 3.300 3.500 3.300zM12 12c-1.700-1-2.300-3-1-5 .700 1 1 1 1 1s.300 0 1-1c1.300 2 .700 4-1 5z",
  "M12 21v-8M12 16c0-2 1.300-3.300 3.500-3.300 0 2-1.300 3.300-3.500 3.300zM12 18c0-2-1.300-3.300-3.500-3.300 0 2 1.300 3.300 3.500 3.300zM12 10.500a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 6.500V4M14 8.500h2.500M10 8.500H7.500M13.400 7.100l1.800-1.800M10.600 7.100L8.800 5.300",
];
const bondMark = (level) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${BOND_MARKS[level - 1] ?? BOND_MARKS[0]}"/></svg>`;
const LEVEL_FLOORS = [0, 10, 30, 70, 140];

const NAP_AFTER_MS = 6 * 60 * 60 * 1000;

let lang = deviceLanguage();
let S = STRINGS[lang];
let settings = { lang: null, userName: "", readAloud: false };
let roster = [];
let illustratedLooks = [];
let selection = 0;
let requestedId = null;
const unsent = new Map();
let historyLines;
let historyLang;
let followScroll = true;
let pollTimer;
let compose = null;
/** The character on stage, as the handler last described it. */
let current = null;
/** The reply being written: `{ text, mood }`, or null. */
let draft = null;
let busy = false;
let failure = null;
let sheet = null;
let reader = null;
let sdk = null;
let previewMood = "happy";
let awake = false;
/** The first words of a first meeting are typed out once per character and language. */
let typedFor = null;
let typeTimer = null;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function api(path, init) {
  const res = await fetch(`../api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}
const post = (path, data) => api(path, { method: "POST", body: JSON.stringify(data ?? {}) });
const put = (path, data) => api(path, { method: "PUT", body: JSON.stringify(data ?? {}) });

/** The reader's own clock as an ISO time with its offset, so a day is the reader's day. */
function localNow() {
  const d = new Date();
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? "+" : "-"}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
  );
}

const nameOf = (meta) => (lang === "zh" ? meta?.nameZh : meta?.name) || meta?.name || "";
const taglineOf = (meta) => (lang === "zh" ? meta?.taglineZh : meta?.tagline) || "";
function artOf(meta) {
  if (!meta) return null;
  const look = lookOf(meta.kind, meta.look);
  return illustratedLooks.find(
    (art) =>
      art.kind === meta.kind &&
      Object.entries(lookOf(art.kind, art.look)).every(
        ([key, value]) => look[key].toLowerCase() === value.toLowerCase(),
      ),
  )?.id;
}

function drawCharacter(meta, mood, options) {
  return portrait(meta, mood, { ...options, art: artOf(meta) });
}

const helloOf = (meta) => (lang === "zh" ? meta?.helloZh : meta?.hello) || "";

/** A reply as paragraphs, an action between asterisks set apart; text only. */
function speech(target, text) {
  target.replaceChildren();
  for (const para of String(text).split(/\n{2,}/)) {
    const p = el("p");
    para.split(/(\*[^*\n]+\*)/).forEach((part) => {
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*"))
        p.append(el("em", { textContent: part.slice(1, -1) }));
      else if (part) p.append(part);
    });
    target.append(p);
  }
}

// ---- drawing ----

function copy() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  for (const node of document.querySelectorAll("[data-copy]"))
    node.textContent = S[node.dataset.copy];
  document.title = S.brand;
  const label = (id, name, text, visible = false) => {
    const button = $(id);
    button.innerHTML = icon(name);
    if (visible) button.append(el("span", { textContent: text }));
    button.title = text;
    button.setAttribute("aria-label", text);
  };
  label("add", "plus", S.add, true);
  label("open-roster", "card", S.roster, true);
  label("open-memory", "memory", S.memory, true);
  label("open-settings", "settings", S.settings, true);
  label("open-card", "card", S.card, true);
  label("chapter", "chapter", S.chapter);
  label("sheet-close", "close", S.close);
  label("aloud", "aloud", S.readAloud);
  $("pin").innerHTML = icon("pin");
  $("aloud").setAttribute("aria-pressed", String(settings.readAloud));
  $("say-text").placeholder = S.say;
  $("say-text").setAttribute("aria-label", S.say);
  $("locale").value = lang;
  $("user-name").placeholder = S.yourNameHint;
}

function thumbnail(meta, mood = "neutral") {
  const mini = el("span", { className: "cc-mini" });
  if (meta) mini.innerHTML = drawCharacter(meta, mood, { face: true });
  return mini;
}

function rosterRows() {
  return roster.map((row) => {
    const button = el(
      "button",
      { type: "button" },
      thumbnail(row.meta),
      el("span", { className: "cc-row-name", textContent: nameOf(row.meta) || row.id }),
    );
    button.setAttribute("aria-current", String(row.id === current?.id));
    button.title = taglineOf(row.meta) || row.error || row.id;
    button.onclick = () => {
      closeSheet();
      void select(row.id);
    };
    return el("li", {}, button);
  });
}

function drawRoster() {
  $("roster").replaceChildren(...rosterRows());
  if (sheet === "roster") drawSheet();
}

function drawScene() {
  const place = current?.scene ?? "plain";
  const phase = phaseOf(new Date().getHours());
  $("place").textContent = S.scenes[place] ?? S.scenes.plain;
  const key = `${place}/${phase}`;
  if ($("scene").dataset.key !== key) {
    $("scene").innerHTML = scene(place, phase);
    $("scene").dataset.key = key;
  }
}

function drawPortrait(pop = false) {
  // A first meeting opens on a smile; a long absence, on a nap.
  const first = current && current.lines.length === 0;
  const mood =
    draft?.mood ?? (napping() ? "sleepy" : first ? "happy" : (current?.mood ?? "neutral"));
  const host = $("portrait");
  if (host.dataset.mood === mood && host.dataset.id === current?.id && !pop) return;
  host.dataset.mood = mood;
  host.dataset.id = current?.id ?? "";
  host.innerHTML = current?.meta ? drawCharacter(current.meta, mood) : "";
  host.setAttribute("aria-label", current?.meta ? `${nameOf(current.meta)}: ${S.moods[mood]}` : "");
  host.dataset.pop = "1";
  setTimeout(() => delete host.dataset.pop, 340);
}

/** Away for hours and not yet spoken to: the character naps until the person says something. */
function napping() {
  if (!current || busy || awake || !current.lastTalkAt) return false;
  return Date.now() - new Date(current.lastTalkAt).getTime() > NAP_AFTER_MS;
}

function message(role, text, at, mood) {
  const user = role === "user";
  const body = el("div", { className: "cc-bubble" });
  speech(body, text);
  const by = el(
    "div",
    { className: "cc-by" },
    user ? settings.userName || S.you : nameOf(current?.meta),
  );
  if (at)
    by.append(
      el("time", {
        dateTime: at,
        textContent: new Date(at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }),
      }),
    );
  const turn = el(
    "article",
    { className: "cc-turn" },
    ...(user ? [] : [thumbnail(current?.meta, mood)]),
    el("div", { className: "cc-message" }, by, body),
  );
  turn.dataset.role = role;
  return turn;
}

function renderHistory() {
  const history = $("history");
  const lines = current?.lines;
  if (historyLines === lines && historyLang === lang) return;
  historyLines = lines;
  historyLang = lang;
  history.replaceChildren();
  if (!current?.meta) return;

  let lastDay = "";
  function dateline(at) {
    const d = at ? new Date(at) : new Date();
    const day = d.toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric" });
    if (day !== lastDay) history.append(el("p", { className: "cc-dateline", textContent: day }));
    lastDay = day;
  }

  if (helloOf(current.meta)) {
    dateline(lines[0]?.at);
    const hello = message("character", helloOf(current.meta), null, "happy");
    hello.querySelector(".cc-bubble").id = "greeting";
    history.append(hello);
    if (!lines.length) typeHello(current.meta);
  }
  for (const line of lines) {
    dateline(line.at);
    if (line.role === "note") {
      const text = line.text.startsWith("level:")
        ? S.levelUp(nameOf(current.meta), S.levels[Number(line.text.slice(6)) - 1])
        : S.chapterNote;
      history.append(el("p", { className: "cc-stage-note", textContent: text }));
    } else history.append(message(line.role, line.text, line.at, line.mood));
  }
}

function buttonsFor(choices, glyph) {
  return choices.map((choice) => {
    const button = el("button", { type: "button" }, el("span", { textContent: choice }));
    button.insertAdjacentHTML("beforeend", icon(glyph));
    button.onclick = () => say(choice, { keepDraft: true });
    return button;
  });
}

function drawConversation() {
  const meta = current?.meta;
  renderHistory();
  const live = $("live-turn");
  live.hidden = !busy;
  if (busy) {
    if (!live.firstChild) live.append(message("character", "", null, "thinking"));
    speech(live.querySelector(".cc-bubble"), draft?.text || S.thinking(nameOf(meta)));
  } else live.replaceChildren();

  const note = $("stage-note");
  const status = current?.error || failure || (napping() ? S.napping(nameOf(meta)) : "");
  note.hidden = !status;
  note.textContent = failure ? `${S.failed} ${failure}` : status;
  const prompts = current?.starter && !current.lines.length && !busy ? S.prompts[current.id] : null;
  const topics = $("topics");
  topics.replaceChildren();
  if (prompts) topics.append(el("h3", { textContent: S.topics }), ...buttonsFor(prompts, "arrow"));
  $("choices").replaceChildren(...buttonsFor(busy ? [] : (current?.choices ?? []), "reply"));
  if (followScroll)
    $("transcript").scrollTop = current?.lines.length ? $("transcript").scrollHeight : 0;
}

function syncSend() {
  const send = $("send");
  const text = busy ? S.stop : S.send;
  send.innerHTML = icon(busy ? "stop" : "send");
  send.append(el("span", { textContent: text }));
  send.setAttribute("aria-label", text);
  send.disabled = busy
    ? !reader || !current?.sessionId
    : !current?.meta || !$("say-text").value.trim();
}

function drawStage() {
  const meta = current?.meta;
  const name = nameOf(meta) || current?.id || "";
  $("who-name").textContent = name;
  $("who-tagline").textContent = taglineOf(meta);
  $("chat-title").textContent = S.chatWith(name);
  const level = current?.bond.level ?? 1;
  const floor = LEVEL_FLOORS[level - 1];
  const next = LEVEL_FLOORS[level] ?? floor;
  $("bond-mark").innerHTML = bondMark(level);
  $("bond-level").textContent = S.levels[level - 1];
  $("bond-fill").style.width =
    `${next > floor ? Math.round((100 * ((current?.bond.points ?? 0) - floor)) / (next - floor)) : 100}%`;
  $("bond").title = S.bondHelp(current?.bond.days ?? 0);
  $("bond").setAttribute(
    "aria-label",
    `${S.levels[level - 1]}. ${S.bondHelp(current?.bond.days ?? 0)}`,
  );

  drawConversation();
  syncSend();
  $("open-memory").disabled = !current;
  $("open-card").disabled = !current;
  $("say-text").disabled = !meta;
  $("chapter").disabled = busy || !current?.sessionId;
  drawPortrait();
}

/** The first words of a first meeting, typed out with the mouth moving; at once without motion. */
function typeHello(meta) {
  const text = helloOf(meta);
  const key = `${current?.id}:${lang}`;
  if (typedFor === key || reducedMotion()) {
    if (typeTimer === null && $("greeting")) speech($("greeting"), text);
    typedFor = key;
    return;
  }
  stopTyping();
  typedFor = key;
  const greeting = $("greeting");
  greeting.replaceChildren();
  let shown = 0;
  talking(true);
  typeTimer = setInterval(() => {
    shown = Math.min(text.length, shown + 2);
    speech(greeting, text.slice(0, shown));
    if (shown >= text.length) stopTyping();
  }, 45);
}

function stopTyping() {
  if (typeTimer === null) return;
  clearInterval(typeTimer);
  typeTimer = null;
  talking(false);
  if ($("greeting") && current?.meta) speech($("greeting"), helloOf(current.meta));
}

function drawSheet() {
  const dialog = $("sheet");
  if (!sheet) {
    if (dialog.open) dialog.close();
    return;
  }
  const body = $("sheet-body");
  body.replaceChildren();
  body.hidden = sheet === "settings";
  $("settings-fields").hidden = sheet !== "settings";
  $("sheet-title").textContent = {
    roster: S.roster,
    settings: S.settings,
    memory: S.memory,
    card: S.card,
    add: S.newTitle,
  }[sheet];
  if (!dialog.open) dialog.showModal();
  if (sheet === "roster") {
    const add = el("button", { type: "button", className: "cc-tool" }, S.add);
    add.insertAdjacentHTML("afterbegin", icon("plus"));
    add.onclick = toggle("add");
    body.append(el("ul", { className: "cc-roster-list" }, ...rosterRows()), add);
  }
  if (sheet === "memory") {
    const items = current?.memory ?? [];
    if (items.length === 0)
      body.append(
        el("p", { className: "cc-help", textContent: S.memoryEmpty(nameOf(current?.meta)) }),
      );
    const list = el("ul", { className: "cc-memory" });
    items.forEach((item, index) => {
      const [day, ...rest] = item.split(" · ");
      const gone = el("button", { type: "button", className: "cc-icon", title: S.forget });
      gone.innerHTML = icon("forget");
      gone.setAttribute("aria-label", S.forget);
      gone.onclick = async () => {
        current.memory = (await post(`/characters/${current.id}/forget`, { index })).memory;
        drawSheet();
      };
      list.append(
        el(
          "li",
          {},
          el(
            "span",
            {},
            rest.length ? el("time", { textContent: day }) : "",
            rest.join(" · ") || item,
          ),
          gone,
        ),
      );
    });
    body.append(list);
    const all = el("button", { type: "button", className: "cc-plain", textContent: S.forgetAll });
    all.dataset.tone = "danger";
    all.onclick = async () => {
      if (all.dataset.armed !== "1") {
        all.dataset.armed = "1";
        all.textContent = S.forgetAllSure;
        return;
      }
      current.memory = (await post(`/characters/${current.id}/forget`, { all: true })).memory;
      drawSheet();
    };
    body.append(
      el("div", { className: "cc-rule cc-actions" }, ...(items.length ? [all] : [])),
      el("p", { className: "cc-help", textContent: S.memoryWhere }),
    );
  }
  if (sheet === "card") drawCard(body);
  if (sheet === "add") drawAdd(body);
}

// ---- the card editor ----

function splitCard(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text ?? "");
  const fields = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  let look = {};
  try {
    look = JSON.parse(fields.look || "{}");
  } catch {
    look = {};
  }
  return { fields, look, body: (match?.[2] ?? "").trim() };
}

const oneLine = (value) =>
  String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
function joinCard({ fields, look, body }) {
  const head = Object.entries({ ...fields, look: JSON.stringify(look) })
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}: ${oneLine(value)}`);
  return `---\n${head.join("\n")}\n---\n\n${body.trim()}\n`;
}

function drawCard(body) {
  const card = splitCard(current.card);
  const kind = KINDS.includes(card.fields.kind) ? card.fields.kind : "penguin";
  const look = lookOf(kind, card.look);
  const face = el("div", { className: "cc-preview-face" });
  const redraw = () =>
    (face.innerHTML = drawCharacter({ kind: card.fields.kind, look: card.look }, previewMood));
  const moods = el("div", { className: "cc-moods" });
  for (const mood of MOODS) {
    const b = el("button", { type: "button", textContent: S.moods[mood] });
    b.setAttribute("aria-pressed", String(mood === previewMood));
    b.onclick = () => {
      previewMood = mood;
      for (const other of moods.children) other.setAttribute("aria-pressed", String(other === b));
      redraw();
    };
    moods.append(b);
  }
  const field = (label, key, { area = false } = {}) => {
    const input = el(area ? "textarea" : "input", { value: card.fields[key] ?? "" });
    if (area) input.rows = 2;
    input.oninput = () => (card.fields[key] = input.value);
    return el("label", { className: "cc-field" }, el("span", { textContent: label }), input);
  };
  const pick = (label, value, options, names, onpick) => {
    const select = el("select");
    for (const option of options)
      select.append(el("option", { value: option, textContent: names[option] ?? option }));
    select.value = value;
    select.onchange = () => onpick(select.value);
    return el("label", { className: "cc-field" }, el("span", { textContent: label }), select);
  };
  const swatches = el("div", { className: "cc-swatches" });
  for (const key of Object.keys(S.colourNames)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(look[key] ?? "")) continue;
    const input = el("input", { type: "color", value: look[key] });
    input.oninput = () => {
      card.look[key] = input.value;
      redraw();
    };
    swatches.append(el("label", {}, input, el("span", { textContent: S.colourNames[key] })));
  }
  const story = el("textarea", { className: "cc-story", value: card.body });
  story.oninput = () => (card.body = story.value);
  const saved = el("span", { className: "cc-help" });
  const save = el("button", { type: "button", className: "wb-primary", textContent: S.save });
  save.onclick = async () => {
    try {
      await put(`/characters/${current.id}`, { card: joinCard(card) });
      saved.textContent = S.saved;
      await refreshRoster();
      await select(current.id, { keepSheet: true });
    } catch (e) {
      saved.textContent = String(e.message ?? e);
    }
  };
  const download = el("a", {
    className: "cc-icon",
    href: `../api/characters/${encodeURIComponent(current.id)}/card`,
    title: S.downloadCard,
  });
  download.setAttribute("download", `${current.id}.card.md`);
  download.setAttribute("aria-label", S.downloadCard);
  download.innerHTML = icon("download");
  const actions = el("div", { className: "cc-actions" }, save, saved, download);
  if (current.starter) {
    const restore = el("button", { type: "button", className: "cc-plain", textContent: S.restore });
    restore.onclick = async () => {
      await post(`/characters/${current.id}/restore`);
      await refreshRoster();
      await select(current.id, { keepSheet: true });
    };
    actions.append(restore);
  } else {
    const remove = el("button", { type: "button", className: "cc-plain", textContent: S.remove });
    remove.dataset.tone = "danger";
    remove.onclick = async () => {
      if (remove.dataset.armed !== "1") {
        remove.dataset.armed = "1";
        remove.textContent = S.removeSure;
        return;
      }
      await api(`/characters/${current.id}`, { method: "DELETE" });
      sheet = null;
      await refreshRoster();
      await select(roster[0]?.id);
    };
    actions.append(remove);
  }
  redraw();
  body.append(
    el(
      "div",
      { className: "cc-preview" },
      face,
      el("div", {}, el("p", { className: "cc-help", textContent: S.faces }), moods),
    ),
    el("div", { className: "cc-two" }, field(S.nameZh, "name_zh"), field(S.name, "name")),
    field(S.taglineZh, "tagline_zh"),
    field(S.tagline, "tagline"),
    el(
      "div",
      { className: "cc-two cc-rule" },
      pick(S.kind, kind, KINDS, S.kinds, (value) => {
        card.fields.kind = value;
        card.look = {};
        current.card = joinCard(card);
        drawSheet();
      }),
      pick(
        S.scene,
        card.fields.scene || "plain",
        SCENES,
        S.scenes,
        (value) => (card.fields.scene = value),
      ),
    ),
    el(
      "div",
      {},
      el("p", { className: "cc-help", textContent: S.colours }),
      swatches,
      ...(artOf(current.meta)
        ? [el("p", { className: "cc-help", textContent: S.customLook })]
        : []),
    ),
    Object.keys(PARTS[kind] ?? {}).length === 0
      ? ""
      : el(
          "div",
          { className: "cc-two" },
          ...Object.entries(PARTS[kind]).map(([part, options]) =>
            pick(
              S.partNames[part] ?? part,
              look[part] ?? options[0],
              options,
              S.partValues,
              (value) => {
                card.look[part] = value;
                redraw();
              },
            ),
          ),
        ),
    el("div", { className: "cc-rule" }, field(S.helloZh, "hello_zh", { area: true })),
    field(S.hello, "hello", { area: true }),
    el(
      "label",
      { className: "cc-field cc-rule" },
      el("span", { textContent: S.story }),
      story,
      el("span", { className: "cc-help", textContent: S.storyHint }),
    ),
    actions,
  );
}

function drawAdd(body) {
  const blank = el("button", { type: "button", className: "cc-plain", textContent: S.newBlank });
  blank.onclick = async () => {
    const { id } = await post("/characters", {});
    await refreshRoster();
    await select(id);
    sheet = "card";
    drawSheet();
  };
  const file = el("input", { type: "file", accept: ".md,text/markdown,text/plain", hidden: true });
  const fromFile = el("button", {
    type: "button",
    className: "cc-plain",
    textContent: S.importCard,
  });
  fromFile.onclick = () => file.click();
  file.onchange = async () => {
    const picked = file.files?.[0];
    file.value = "";
    if (!picked) return;
    try {
      // A downloaded card is named <id>.card.md; anything else gets a fresh id.
      const id = picked.name.replace(/\.card\.md$|\.md$/i, "").toLowerCase();
      const made = await post("/characters", { id, card: await picked.text() });
      await refreshRoster();
      await select(made.id);
      sheet = "card";
      drawSheet();
    } catch (e) {
      status.textContent = `${S.importFailed} ${e.message ?? e}`;
    }
  };
  const idea = el("textarea", { rows: 4, placeholder: S.newAskHint });
  const status = el("p", { className: "cc-help" });
  const go = el("button", { type: "button", className: "wb-primary", textContent: S.newAskGo });
  const watch = async () => {
    status.textContent = S.composing;
    go.disabled = true;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refreshRoster();
      if (compose?.status !== "running") break;
    }
    go.disabled = false;
    if (compose?.status === "done") {
      sheet = null;
      await select(compose.id);
    } else status.textContent = `${S.composeFailed} ${compose?.error ?? ""}`;
  };
  go.onclick = async () => {
    if (!idea.value.trim()) return idea.focus();
    try {
      await post("/compose", { text: idea.value });
      await watch();
    } catch (e) {
      status.textContent = String(e.message ?? e);
    }
  };
  if (compose?.status === "running") {
    idea.value = compose.idea;
    void watch();
  }
  body.append(
    el("div", { className: "cc-actions" }, blank, fromFile, file),
    el("label", { className: "cc-field cc-rule" }, el("span", { textContent: S.newAsk }), idea),
    el("div", { className: "cc-actions" }, go),
    status,
  );
}

// ---- talking ----

async function refreshRoster() {
  const data = await api("/characters");
  const order = ["sunny", ...illustratedLooks.map((art) => art.id)];
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  roster = data.characters.toSorted((a, b) => rank(a.id) - rank(b.id));
  compose = data.compose;
  drawRoster();
}

async function refresh() {
  if (!current || current.id !== requestedId) return;
  const version = selection;
  const data = await api(`/characters/${current.id}`);
  if (version !== selection) return;
  const wasRunning = busy;
  current = data;
  failure = current.failure;
  busy = current.running;
  if (!busy) {
    draft = null;
    talking(false);
    stopReader();
    const last = current.lines.at(-1);
    if (wasRunning && (last?.role === "character" || last?.role === "note")) {
      const reply = current.lines.findLast((l) => l.role === "character")?.text;
      $("announcement").textContent = reply ?? "";
      readAloud(reply);
    }
  }
  const row = roster.find((r) => r.id === current.id);
  if (row) Object.assign(row, { bond: current.bond, mood: current.mood });
  drawRoster();
  drawScene();
  drawStage();
  if (sheet === "memory") drawSheet();
}

async function select(id, { keepSheet = false } = {}) {
  if (!id) return;
  const version = ++selection;
  requestedId = id;
  if (current) unsent.set(current.id, $("say-text").value);
  stopReader();
  stopTyping();
  talking(false);
  const data = await api(`/characters/${id}`);
  if (version !== selection) return;
  if (!keepSheet) closeSheet();
  current = data;
  $("announcement").textContent = "";
  draft = null;
  awake = false;
  failure = data.failure;
  busy = data.running;
  $("say-text").value = unsent.get(id) ?? "";
  followScroll = true;
  drawRoster();
  drawScene();
  delete $("portrait").dataset.id;
  drawStage();
  drawSheet();
  if (busy) void follow(current.sessionId);
}

let talkTimer = null;
function talking(on) {
  if (on && (talkTimer !== null || reducedMotion())) return;
  clearInterval(talkTimer);
  talkTimer = null;
  const host = $("portrait");
  host.dataset.talk = "0";
  if (on)
    talkTimer = setInterval(() => (host.dataset.talk = host.dataset.talk === "1" ? "0" : "1"), 150);
}

function stopReader() {
  clearTimeout(pollTimer);
  reader?.close();
  reader = null;
}

/** Follows the reply as it is written; without the page SDK, asks the handler until it is done. */
async function follow(sessionId) {
  stopReader();
  const version = selection;
  const active = () => version === selection && busy && current?.sessionId === sessionId;
  const poll = async () => {
    if (!active()) return;
    await refresh();
    if (active()) pollTimer = setTimeout(poll, 700);
  };
  try {
    sdk ??= await import("../sdk/workbench.js");
  } catch {
    if (active()) pollTimer = setTimeout(poll, 700);
    return;
  }
  if (!active()) return;
  let done = "";
  let live = "";
  const mine = (reader = sdk.followSession(sessionId, { tailLimit: 1 }));
  syncSend();
  mine.on("event", ({ record }) => {
    if (reader !== mine || record.origin?.length) return;
    const p = record.payload || {};
    if (p.type === "request_begin") done = live = "";
    else if (p.type === "partial_text" && p.role === "assistant") {
      if (p.event_type === "start") live = p.text || "";
      else if (p.event_type === "delta") live += p.text || "";
    } else if (p.type === "text" && p.role === "assistant") {
      done = done ? `${done}\n\n${p.text}` : p.text;
      live = "";
    } else if (p.type === "task_end") return void poll();
    else return;
    if (!busy) return;
    const next = draftOf(done && live ? `${done}\n\n${live}` : done || live);
    draft = next;
    talking(Boolean(live));
    drawStage();
  });
  mine.on("reset", () => {
    done = live = "";
  });
}

async function say(text, { keepDraft = false } = {}) {
  const words = String(text ?? "").trim();
  if (!words || busy || !current?.meta || current.id !== requestedId) return;
  const version = selection;
  followScroll = true;
  stopTyping();
  awake = true;
  busy = true;
  failure = null;
  draft = null;
  current.lines = [...current.lines, { role: "user", text: words, at: localNow() }];
  current.choices = [];
  if (!keepDraft) $("say-text").value = "";
  drawStage();
  try {
    const { sessionId } = await post(`/characters/${current.id}/say`, {
      text: words,
      now: localNow(),
      lang,
    });
    if (version !== selection) return;
    current.sessionId = sessionId;
    follow(sessionId);
  } catch (e) {
    if (version !== selection) return;
    busy = false;
    failure = String(e.message ?? e);
    if (!$("say-text").value) $("say-text").value = words;
    drawStage();
  }
}

/** Speaks a reply with a voice that runs on this device; never with one that needs the network. */
function readAloud(text) {
  if (!settings.readAloud || !text || !("speechSynthesis" in window)) return;
  const voice = speechSynthesis
    .getVoices()
    .find((v) => v.localService && v.lang.toLowerCase().startsWith(lang));
  if (!voice) return;
  const utterance = new SpeechSynthesisUtterance(text.replace(/\*[^*\n]+\*/g, ""));
  utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// ---- wiring ----

$("say").onsubmit = (event) => {
  event.preventDefault();
  if (busy) return void sdk?.abortSession(current.sessionId);
  say($("say-text").value);
};
$("say-text").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!busy) $("say").requestSubmit();
  }
};
$("say-text").onfocus = () => {
  if (!napping()) return;
  awake = true;
  drawStage();
};
$("say-text").oninput = syncSend;
$("transcript").onscroll = () => {
  const log = $("transcript");
  followScroll = log.scrollHeight - log.scrollTop - log.clientHeight < 45;
};
function closeSheet() {
  sheet = null;
  drawSheet();
}
const toggle = (name) => () => {
  sheet = name;
  drawSheet();
};
$("open-roster").onclick = toggle("roster");
$("open-settings").onclick = toggle("settings");
$("open-memory").onclick = toggle("memory");
$("open-card").onclick = toggle("card");
$("add").onclick = toggle("add");
$("sheet-close").onclick = closeSheet;
$("sheet").onclose = () => {
  if (!$("sheet").open) sheet = null;
};
$("sheet").onclick = (event) => {
  if (event.target !== $("sheet")) return;
  const rect = $("sheet").getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    closeSheet();
};
$("chapter").onclick = async () => {
  await post(`/characters/${current.id}/chapter`);
  await refresh();
};
$("locale").onchange = async () => {
  stopTyping();
  lang = $("locale").value;
  S = STRINGS[lang];
  settings = (await put("/settings", { lang })).settings;
  copy();
  drawRoster();
  drawScene();
  drawStage();
  drawSheet();
};
$("user-name").onchange = async () => {
  settings = (await put("/settings", { userName: $("user-name").value })).settings;
};
$("aloud").onclick = async () => {
  settings = (await put("/settings", { readAloud: !settings.readAloud })).settings;
  copy();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopReader();
  else if (busy && current?.sessionId) follow(current.sessionId);
});

const stage = $("stage");
stage.onpointermove = (event) => {
  if (reducedMotion() || event.pointerType === "touch") return;
  const box = stage.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width - 0.5;
  const y = (event.clientY - box.top) / box.height - 0.5;
  stage.style.setProperty("--look-x", `${x * 7}px`);
  stage.style.setProperty("--look-y", `${y * 4}px`);
  stage.style.setProperty("--lean", `${x * 1.8}deg`);
};
stage.onpointerleave = () => {
  for (const prop of ["--look-x", "--look-y", "--lean"]) stage.style.removeProperty(prop);
};

// Blinks at an uneven pace, and the room's light follows the clock.
(function blink() {
  const host = $("portrait");
  if (!reducedMotion()) host.dataset.blink = "1";
  setTimeout(() => (host.dataset.blink = "0"), 130);
  setTimeout(blink, 2600 + Math.random() * 3200);
})();
setInterval(drawScene, 5 * 60 * 1000);

/** The handler announces a character whose files changed: the Agent wrote a card or a memory. */
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
    void refreshRoster();
  };
  events.addEventListener("characters", async (event) => {
    const { changed, removed } = JSON.parse(event.data);
    await refreshRoster();
    if (!current) return void select(roster[0]?.id);
    if (removed.includes(current.id)) return void select(roster[0]?.id);
    // Not while a reply streams, and not under an open card editor: its fields are the person's.
    if (changed.includes(current.id) && !busy && sheet !== "card") await refresh();
  });
}

(async function start() {
  copy();
  const info = await api("/info");
  settings = info.settings;
  illustratedLooks = info.illustratedLooks ?? [];
  if (settings.lang) {
    lang = settings.lang;
    S = STRINGS[lang];
  }
  $("user-name").value = settings.userName;
  copy();
  if (!info.supported) {
    $("unsupported").hidden = false;
    $("unsupported").textContent = S.unsupported;
    drawScene();
    return;
  }
  await refreshRoster();
  const recent = [...roster].sort((a, b) =>
    String(b.lastTalkAt ?? "").localeCompare(String(a.lastTalkAt ?? "")),
  )[0];
  await select(recent?.id);
  listen();
})().catch((error) => {
  $("unsupported").hidden = false;
  $("unsupported").textContent = String(error.message ?? error);
});

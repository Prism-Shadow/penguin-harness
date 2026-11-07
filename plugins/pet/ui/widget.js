/**
 * The pet widget's behaviour: the DeepSeek whale (大肥鱼) run by the Coopanion kit.
 *
 * The body is the figure pack at ./figure/whale (figure.json → createWhaleBody): the kit
 * (./figure/kit/body.js) simulates her — walking, roaming, sitting, sleeping, being picked
 * up, thrown, touched — and the pack's figure.js draws each frame with its WebGL rig. This
 * document is the host: it hands the kit a stage (bounds, pointer events), relays what the
 * body reports into the speech bubble, and keeps the pet's server state fresh — the same
 * reader-and-occasional-writer contract as before, at GET/PATCH
 * /api/plugins/<package>/state with the user's cookie (`credentials: "same-origin"`): an
 * idle tick lowers the fullness a little and PATCHes it back, so the pet grows hungry
 * however you look at it. Feeding is a double-click: it eats one portion from the pantry
 * (+fullness), PATCHed.
 *
 * Her dialog is a right-click on her (#panel, ./src/panel.tsx → ./dist by `pnpm build:ui`): the
 * daily签到 and the daily Token graph beside her state and the shop her coins are spent in, and
 * how often she talks and how much of the page she roams. It is the shared UI package's work
 * (React + @prismshadow/penguin-ui) and is loaded on that first right-click, so the preload the
 * dock does costs nothing until someone asks for it; this file owns her state and hands the
 * dialog a snapshot to draw. Everything is stored in the same document, so every face of the
 * pet — the CLI's `pet` commands included — sees one pet.
 *
 * The dock mounts this document bare and fills the window with it (no card, no title bar, no
 * close button — the dock's tile opens and closes it), so the page is her stage and the document
 * also answers where the pointer is over her: the handshake below is what keeps the page beneath
 * this frame clickable — while her dialog is up the whole frame counts as "on her", or the
 * dialog could not be clicked at all.
 */

import * as kit from "./figure/kit/body.js";
import { createWhaleBody } from "./figure/whale/figure.js";

const STATE_URL = "/api/plugins/@penguinharness/pet/state";
/**
 * The version of this package's `ui/` files, as the server stamped the URL it framed
 * (`?v=`, server: plugin/package.ts, contributions.ts). Every file the figure pack loads
 * carries the same query, so the browser keeps them for good instead of re-fetching the
 * whole pack on each open — and an edit under `ui/` moves the stamp, so the URL too.
 */
const VERSION = new URLSearchParams(location.search).get("v") ?? "";
const FIGURE_BASE = new URL("./figure/whale/", import.meta.url);

/** A file of the figure pack, under the version this document was framed with (see VERSION). */
function packUrl(p) {
  const url = new URL(p, FIGURE_BASE);
  if (VERSION !== "") url.search = `?v=${encodeURIComponent(VERSION)}`;
  return url;
}

/** The pack's model, read here rather than by the figure so it carries the same query. */
async function loadModel() {
  const res = await fetch(packUrl("model.json"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`model.json answered ${res.status}`);
  return res.json();
}

const TICK_MS = 30_000;
/** Fullness lost per idle tick, and gained per portion eaten. */
const HUNGER = 2;
const FEED = 20;
/** How long a bubble line stays up. */
const BUBBLE_MS = 3400;
/**
 * How tall her figure is on the page, in CSS pixels — the 256-unit square she is drawn in. Fixed,
 * not a share of the window: a pet that grew with the window would tower over a maximized app.
 */
const PET_PX = 280;
/** What a coin is: one million Tokens used, and the portions one coin buys at her shop. */
const TOKENS_PER_COIN = 1_000_000;
const PORTIONS_PER_COIN = 5;
/** The starter bowl a new pet comes with, so the first feed needs no Token history. */
const GIFT_COINS = 3;
/** How often the Token total is read again — the coin balance follows it. */
const MINE_MS = 5 * 60_000;
/** How many coins the shop sells at once. */
const BUY_AMOUNTS = [1, 5, 10];
/** What a daily签到 pays, and the extra it pays every STREAK_EVERY days in a row. */
const CHECKIN_FOOD = 1;
const CHECKIN_COINS = 2;
const STREAK_EVERY = 7;
const STREAK_BONUS = 5;

const root = document.getElementById("root");
const bubbleEl = document.getElementById("bubble");
/** Where the dialog's React tree is mounted (empty until the first right-click). */
const panelRoot = document.getElementById("panel");

let body = null;
let fullness = 0;
/** Portions of food in the pantry. */
let food = 0;
/** Coins: earned from Token usage, spent on food. */
let coins = 0;
/** Lifetime Tokens already turned into coins — the waterline the next sync measures from. */
let mined = 0;
/** Whether the starter bowl was granted (it is granted once, then the state says so). */
let gift = false;
/** The last day she was signed in for, and how many days in a row (`pet.checkin`). */
let checkin = { last: "", streak: 0 };
let doing = "idle";
let bubbleUntil = 0;

/* ---------- her menu's vocabulary ---------- */

/** How often she speaks on her own: the idle gap between one line and the next. */
const TALKS = {
  off: { idle: 0 },
  rare: { idle: 4 * 60_000 },
  normal: { idle: 100_000 },
  chatty: { idle: 30_000 },
};
let talk = "normal";

/** How much of the page she may roam: the stage box, and whether she wanders at all. */
const AREAS = {
  page: { top: "0", roam: "free" },
  lower: { top: "52%", roam: "free" },
  dock: { top: "calc(100% - 240px)", roam: "free" },
  spot: { top: "0", roam: "off" },
};
let area = "page";

/** Where the stage box sits in this document, so a stage point and a document point convert. */
let rootBox = { left: 0, top: 0 };

/** The stage the body stands on: the whole page — one logo unit is S pixels, the whale inside a 256-unit square. */
function bounds() {
  const r = root.getBoundingClientRect();
  // Her size follows the window, not the stage box: switching to a low activity area must not
  // shrink her, and a stage box shorter than she is simply lets her head stand above it.
  return {
    W: r.width,
    H: r.height,
    floorY: r.height - 8,
    S: Math.min(PET_PX, innerHeight - 24) / 256,
  };
}

function refreshBox() {
  const r = root.getBoundingClientRect();
  rootBox = { left: r.left, top: r.top, width: r.width, height: r.height };
}

function docPoint(e) {
  return { x: e.clientX, y: e.clientY };
}

/** A document point in the stage's own pixels (the stage box need not start at 0,0). */
function stagePoint(e) {
  return { x: e.clientX - rootBox.left, y: e.clientY - rootBox.top };
}

/** Puts the stage box where the chosen area keeps it, and lets her wander (or not) there. */
function applyArea() {
  root.style.top = (AREAS[area] ?? AREAS.page).top;
  refreshBox();
  body?.resize();
  body?.set({ roam: (AREAS[area] ?? AREAS.page).roam });
}

/* ---------- what the body reports → the bubble ---------- */

const TOUCH_LINES = {
  pet: ["嘿嘿，好痒～", "再摸一下嘛", "呜……最喜欢你了", "鳍都要摇起来了"],
  poke: ["戳我干嘛！", "欸？", "……有病吧（小声）"],
  grab: ["哇啊——飞起来了！", "放开我啦（并没有挣扎）", "拎鱼小达人"],
  throw: ["呀啊啊啊啊——", "旋！转！突！击！", "落点请预判一下"],
  drop: ["安全着陆～", "屁股……没事", "下次轻一点放"],
  crash: ["呜哇，撞到了", "好痛……鱼要碎了", "这个场地有毒"],
};

const HUNGRY_LINES = ["肚子……空了……", "饿扁了，投喂一下？", "闻到饭味了吗（没有）"];
const FEED_LINES = ["好吃！谢谢你！", "嗷呜——饱了饱了", "这口是山珍海味"];
const BROKE_LINES = ["没吃的了……右键我，用币买一点？", "仓库空啦，点我右键看看"];
const BUY_LINES = ["买到了！这下不饿了", "口粮到货～", "囤货好开心"];
const COIN_LINES = ["攒到一个币！", "又有币进账了", "用掉的 token 变成饭钱了"];
/** What she says when nobody is asking: short, quiet, about the day. */
const MUSINGS = [
  "今天也写了好多代码呢",
  "要不要起来走两步？",
  "我在这儿陪着你",
  "这个项目好大呀",
  "喝点水吧",
  "光标又闪了好久",
  "刚才那行好像写错了（小声）",
  "累了就歇一会儿",
];

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

/** One line in the bubble. A muted pet says nothing — not the reactions either. */
function say(text, ms = BUBBLE_MS) {
  if (talk === "off") return;
  bubbleEl.textContent = text;
  bubbleEl.style.display = "";
  bubbleUntil = performance.now() + ms;
  body?.talk?.();
}

/** The kit's events, minus the ones nothing here answers. */
function onEvent(kind, detail) {
  if (kind === "touch" && detail && TOUCH_LINES[detail.kind]) say(pick(TOUCH_LINES[detail.kind]));
}

/* ---------- the dock's click-through handshake ----------
 *
 * The dock mounts this document bare (chrome: "bare"): no border, no title bar, no close
 * button, just the whale on top of the page. So the frame must not eat the page's clicks. The
 * dock relays every pointer position it sees over the frame as
 * `{ penguin: "widget-probe", x, y }` in this document's pixels, and gives the frame pointer
 * events only while we answer `{ penguin: "widget-over", over: true }` — the body's own hit
 * circles (layout().hit) are what we check against, plus the panel she has open (a menu the
 * page could click through would be unusable). The pointer leaving the frame, or walking off
 * her while she is drawn elsewhere, answers false and the page gets its clicks back.
 *
 * The dock also mounts this document BEFORE the tile that opens it is pressed (that is what
 * makes the press instant), so the frame is told which state it is in —
 * `{ penguin: "widget-shown", shown }` — and runs nothing while it is closed.
 */

let over = false;
let pressed = false;
let lastAt = null;
/** Whether her dialog is on screen: while it is, the frame holds the pointer for its whole life. */
let panelOpen = false;
/**
 * A pointer that has not moved since the dialog opened. She walks while it is up, so the point
 * the frame was given can stop being on her a moment later — but the hand the opened it has not
 * gone anywhere, and a dialog that shut itself as she stepped away could not be used at all.
 * Only a NEW position (the dock's probe, or a move of our own) may take the pointer back.
 */
let resting = false;
/**
 * Whether anyone can see this document. The dock mounts the frame AHEAD of the click that
 * opens it — that is the preload — and says which state it is in with
 * `{ penguin: "widget-shown", shown }` on its own load and on every open and close. Closed
 * means nothing runs: no frame loop, no hunger tick, no Token mining, no pointer probes. A
 * preloaded pet therefore costs nothing while she is out of sight.
 */
let shown = true;
let frameId = 0;
/** Her state is read and her figure is up: the clocks may run. */
let ready = false;
const clocks = new Set();

function onPet(at) {
  if (!body || at === null) return false;
  const x = at.x - rootBox.left;
  const y = at.y - rootBox.top;
  return body.layout().hit.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
}

function answered(next) {
  if (next === over) return;
  over = next;
  // The dock is the only parent this document has; posting to itself (opened on its own) is
  // harmless — nothing here acts on the message it sends.
  parent.postMessage({ penguin: "widget-over", over: next }, location.origin);
  // The pointer went back to the page: her dialog goes with it.
  if (!next) closePanel();
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const data = e.data;
  if (data === null || typeof data !== "object") return;
  if (data.penguin === "widget-shown") {
    if (typeof data.shown === "boolean") setShown(data.shown);
    return;
  }
  if (data.penguin !== "widget-probe") return;
  // A frame nobody sees takes no pointer: the dock does not relay one either, and if an old
  // probe arrives after the close it must not hand the frame back its events.
  if (!shown || typeof data.x !== "number" || typeof data.y !== "number") return;
  lastAt = { x: data.x, y: data.y };
  resting = false;
  answered(onPet(lastAt) || panelOpen);
});

/* ---------- pointer: the document relays to the body ----------
 *
 * The listeners are on the document, not on the stage box: her head is drawn above a low stage
 * box, and a click there must count as a click on her.
 */

document.addEventListener("pointerdown", (e) => {
  // Her dialog owns every pointer it gets: the frame only takes events while it is up, and the
  // scrim under it is the dialog's own (it dismisses on a click, not the stage).
  if (panelOpen) return;
  const at = docPoint(e);
  if (onPet(at)) {
    root.setPointerCapture?.(e.pointerId);
    pressed = true;
    body?.pointer("down", stagePoint(e));
  }
});

document.addEventListener("pointermove", (e) => {
  if (panelOpen) return;
  const at = docPoint(e);
  lastAt = at;
  resting = false;
  body?.pointer("move", stagePoint(e));
  if (!pressed) answered(onPet(at));
});

document.addEventListener("pointerup", (e) => {
  if (panelOpen) return;
  const at = docPoint(e);
  pressed = false;
  body?.pointer("up", stagePoint(e));
  answered(onPet(at));
});

document.addEventListener("pointercancel", (e) => {
  pressed = false;
  body?.pointer("cancel", stagePoint(e));
});

document.documentElement.addEventListener("pointerleave", () => {
  if (panelOpen) return; // a dialog stays up while the pointer is out of the window
  body?.pointer("leave", null);
  lastAt = null;
  answered(false);
});

/* ---------- her dialog: the shared UI package's panel, loaded on demand ---------- */

let idleAt = 0;

/** An open dialog keeps her still: she must not walk out from under the hand using it. */
function panelsOpen(open) {
  body?.set({ dialogOpen: open });
}

/** The pet, as her dialog draws it (ui/src/types.ts: PetSnapshot). */
function snapshot() {
  return { name: "", fullness, food: Math.floor(food), coins, mined, gift, talk, area, checkin };
}

/** A file beside this document, under the version stamp it was framed with (see VERSION). */
function uiUrl(path) {
  const url = new URL(path, import.meta.url);
  if (VERSION !== "") url.search = `?v=${encodeURIComponent(VERSION)}`;
  return url.href;
}

/** The dialog's sheet, in before it is drawn: a dialog that landed unstyled would flash. */
let sheet = null;
function loadSheet() {
  sheet ??= new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = uiUrl("./dist/panel.css");
    link.dataset.petPanel = "";
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => reject(new Error(`panel.css ${link.href}`)));
    document.head.append(link);
  });
  return sheet;
}

/** The dialog module and the handle it hands back; both stay null until the first right-click. */
let panel = null;
let loading = null;

/** Loads the dialog once: its sheet, then the module — React and the UI package ride inside it. */
function ensurePanel() {
  loading ??= Promise.all([loadSheet(), import(uiUrl("./dist/panel.js"))])
    .then(([, mod]) => {
      panel = mod.mountPetPanel(panelRoot, {
        // What the dialog prints is what this file spends: the rules are handed over, never
        // copied into a second vocabulary that could drift from these numbers.
        rules: {
          feed: FEED,
          portionsPerCoin: PORTIONS_PER_COIN,
          tokensPerCoin: TOKENS_PER_COIN,
          buyAmounts: BUY_AMOUNTS,
          checkinFood: CHECKIN_FOOD,
          checkinCoins: CHECKIN_COINS,
          streakEvery: STREAK_EVERY,
          streakBonus: STREAK_BONUS,
        },
        buy,
        checkin: signIn,
        setTalk: (key) => setTalk(key),
        setArea: (key) => setArea(key),
        close: closePanel,
      });
    })
    .catch((err) => {
      loading = null;
      fail(`她的小店没开起来。${err?.message ?? ""}`);
      throw err;
    });
  return loading;
}

/** A load already under way (a second right-click while the bundle is in flight). */
let opening = false;

/** Hands the dialog the current numbers; a closed dialog keeps nothing. */
function pushSnapshot() {
  if (panelOpen) panel?.update(snapshot());
}

async function openPanel() {
  if (panelOpen || opening || !shown) return;
  opening = true;
  try {
    await ensurePanel();
  } catch {
    return;
  } finally {
    opening = false;
  }
  panelOpen = true;
  resting = true;
  panelsOpen(true);
  panel?.open(snapshot());
  answered(true);
}

function closePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  resting = false;
  panel?.close();
  panelsOpen(false);
  // Whoever was looking gets the pointer back the way they had it: over her, if it still is.
  answered(onPet(lastAt));
}

/* ---------- her habits: how often she talks, how much of the page she roams ---------- */

async function setTalk(key) {
  if (!Object.hasOwn(TALKS, key) || key === talk) return;
  talk = key;
  idleAt = 0;
  pushSnapshot();
  try {
    await patch({ pet: { talk } });
  } catch {
    /* the next read reads the truth back */
  }
}

async function setArea(key) {
  if (!Object.hasOwn(AREAS, key) || key === area) return;
  area = key;
  applyArea();
  pushSnapshot();
  try {
    await patch({ pet: { area } });
  } catch {
    /* the next read reads the truth back */
  }
}

/** The local calendar day of an instant, `yyyy-mm-dd` — the签到's own clock. */
function dayKey(at) {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 签到: once a day, a portion of food and a couple of coins, and a little extra every
 * STREAK_EVERY days in a row. The reward is computed here and written in one PATCH; a refused
 * write puts the numbers back, because a dialog that said "已签到" for a day the server never
 * heard of would be worse than no签到 at all.
 */
async function signIn() {
  const today = dayKey(new Date());
  if (checkin.last === today) return;
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const before = { food, coins, checkin };
  const streak = checkin.last === yesterday ? checkin.streak + 1 : 1;
  const bonus = streak % STREAK_EVERY === 0 ? STREAK_BONUS : 0;
  checkin = { last: today, streak };
  food += CHECKIN_FOOD;
  coins += CHECKIN_COINS + bonus;
  pushSnapshot();
  say(bonus > 0 ? `连续 ${streak} 天！多给你 ${bonus} 枚币` : "签到成功，今天也有饭吃～");
  try {
    await patch({ pet: { food, coins, checkin } });
  } catch {
    ({ food, coins, checkin } = before);
    pushSnapshot();
  }
}

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (onPet(docPoint(e))) void openPanel();
  else closePanel();
});

/* ---------- the pantry: feeding, buying, and the coins Token usage earns ---------- */

async function feed() {
  if (!body) return;
  if (food < 1) {
    say(pick(BROKE_LINES));
    void openPanel();
    return;
  }
  food -= 1;
  fullness = Math.min(100, fullness + FEED);
  body.do("excited");
  say(pick(FEED_LINES));
  try {
    await patch({ pet: { fullness, food } });
  } catch {
    /* the next tick reads the truth back */
  }
  pushSnapshot();
}

async function buy(n) {
  if (coins < n) return;
  coins -= n;
  food += n * PORTIONS_PER_COIN;
  say(pick(BUY_LINES));
  pushSnapshot();
  try {
    await patch({ pet: { coins, food } });
  } catch {
    /* the next read reads the truth back */
  }
  pushSnapshot();
}

/** Reads every Project's lifetime Token total and turns what is new into coins. */
let mining = false;
async function mine() {
  if (mining) return;
  mining = true;
  try {
    const projects = await readJson("/api/projects");
    let lifetime = 0;
    for (const p of projects.projects ?? []) {
      const totals = await readJson(`/api/projects/${encodeURIComponent(p.projectId)}/usage/model-totals`);
      for (const t of totals.totals ?? []) lifetime += typeof t.tokens === "number" ? t.tokens : 0;
    }
    if (lifetime <= mined) return;
    const wasWhole = Math.floor(coins);
    coins += (lifetime - mined) / TOKENS_PER_COIN;
    mined = lifetime;
    if (Math.floor(coins) > wasWhole) say(pick(COIN_LINES));
    await patch({ pet: { coins, mined } });
    pushSnapshot();
  } catch {
    /* an unreachable server keeps the balance she already has */
  } finally {
    mining = false;
  }
}

/* ---------- server state: read, patch, apply ---------- */

async function readJson(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function read() {
  return readJson(STATE_URL);
}

async function patch(update) {
  const res = await fetch(STATE_URL, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`patch ${res.status}`);
  return res.json();
}

/** A wish from the state document the body acts on once: external orders beat roaming for a while. */
function wish(next) {
  if (!body || next === doing) return;
  doing = next;
  if (next === "walk") body.walk(bounds().W * (0.2 + Math.random() * 0.6));
  else if (next === "sit") body.do("sit");
  else if (next === "sleep") body.do("sleep");
  else if (next === "eat") { body.do("excited"); say("好好吃！"); }
  else body.do("stand");
}

function apply(state) {
  const doc = state ?? {};
  const pet = doc.pet ?? {};
  if (typeof pet.fullness === "number") fullness = pet.fullness;
  if (typeof pet.food === "number") food = pet.food;
  if (typeof pet.coins === "number") coins = pet.coins;
  if (typeof pet.mined === "number") mined = pet.mined;
  if (typeof pet.gift === "boolean") gift = pet.gift;
  if (typeof pet.talk === "string" && Object.hasOwn(TALKS, pet.talk) && pet.talk !== talk) {
    talk = pet.talk;
    idleAt = 0;
  }
  if (typeof pet.area === "string" && Object.hasOwn(AREAS, pet.area) && pet.area !== area) {
    area = pet.area;
    applyArea();
  }
  if (pet.checkin !== null && typeof pet.checkin === "object") {
    const stored = pet.checkin;
    checkin = {
      last: typeof stored.last === "string" ? stored.last : "",
      streak: typeof stored.streak === "number" ? stored.streak : 0,
    };
  }
  // Her starter bowl: granted once, and the state says so from then on.
  if (pet.gift !== true && !gift) {
    gift = true;
    coins += GIFT_COINS;
    void patch({ pet: { coins, gift: true } }).catch(() => {});
  }
  if (doc.mood?.doing) wish(doc.mood.doing);
  const line = doc.mood?.bubble;
  if (line) say(line);
  pushSnapshot();
}

/** One idle tick: the pet grows a little hungry, and the server keeps the document. */
async function tick() {
  if (fullness <= 0) { if (body && Math.random() < 0.5) say(pick(HUNGRY_LINES)); return; }
  try {
    const answer = await patch({ pet: { fullness: Math.max(0, fullness - HUNGER) } });
    apply(answer.state);
    if (fullness < 15 && Math.random() < 0.5) { body?.do("sad"); say(pick(HUNGRY_LINES)); }
  } catch { /* the next tick tries again; a widget stays quiet about its failures */ }
}

/* ---------- the frame loop ---------- */

/** Her own chatter: one line per gap, only while the page is in front of someone. */
function chatter(now) {
  const gap = TALKS[talk]?.idle ?? 0;
  if (!gap) { idleAt = 0; return; }
  if (!idleAt) { idleAt = now + gap; return; }
  if (now < idleAt) return;
  idleAt = now + gap * (0.75 + Math.random() * 0.5);
  if (document.hidden) return;
  say(fullness < 30 ? pick(HUNGRY_LINES) : pick(MUSINGS));
}

let last = 0;
function frame(now) {
  frameId = 0;
  if (!shown) { last = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  body.step(dt);
  chatter(now);
  // She walks: a pointer that was on her a moment ago may be over the page again now — unless
  // it has not moved since a panel opened, which keeps the frame's pointer (see `resting`).
  if (over && !pressed && !resting) answered(onPet(lastAt) || panelOpen);
  const bubble = bubbleEl.textContent && now < bubbleUntil;
  if (bubble) {
    const at = body.layout().bubble;
    bubbleEl.style.left = `${rootBox.left + at.x}px`;
    bubbleEl.style.top = `${rootBox.top + Math.max(18, at.y)}px`;
  } else if (bubbleEl.style.display !== "none") {
    bubbleEl.style.display = "none";
    bubbleEl.textContent = "";
  }
  frameId = requestAnimationFrame(frame);
}

/** The two clocks that write her state: hunger beside the pack's own eating, and the Token waterline. */
function startClocks() {
  // Nothing ticks before her state is read and the figure is up: a tick against a state that
  // has not arrived yet would patch over it, and mining would count the whole history at once.
  if (!ready || clocks.size > 0) return;
  clocks.add(setInterval(tick, TICK_MS));
  void mine();
  clocks.add(setInterval(mine, MINE_MS));
}

function stopClocks() {
  for (const id of clocks) clearInterval(id);
  clocks.clear();
}

/**
 * The dock's open/close, as the pet sees it: closed stops every loop and clears whatever she
 * was showing, so reopening starts from the same place as a fresh look — with her where she
 * was left (the state on the server), never mid-animation.
 */
function setShown(next) {
  if (next === shown) return;
  shown = next;
  if (!shown) {
    closePanel();
    bubbleUntil = 0;
    bubbleEl.textContent = "";
    bubbleEl.style.display = "none";
    // A pointer that was on her when the dock closed never comes back: the next open starts
    // with the page holding its own clicks.
    over = false;
    pressed = false;
    stopClocks();
    return;
  }
  last = 0;
  // The window may have been resized while nobody was looking: the stage is measured again
  // before she is drawn, so she stands where the page actually is now.
  refreshBox();
  body?.resize();
  if (body && !frameId) frameId = requestAnimationFrame(frame);
  startClocks();
}

function fail(message) {
  if (!document.querySelector(".err")) {
    const err = document.createElement("div");
    err.className = "err";
    err.textContent = message;
    document.body.appendChild(err);
  }
}

async function start() {
  try {
    const answer = await read();
    document.querySelector(".err")?.remove();
    refreshBox();
    const stage = bounds();
    body = await createWhaleBody(FIGURE_BASE, {
      kit,
      // The model and the pack's textures come from the package's own `ui/`, under the
      // version this document was framed with: cacheable for good, and never stale (see
      // VERSION above). `model` is read here rather than by the figure so that it, too,
      // carries the query — it is the first file the figure needs.
      model: await loadModel(),
      asset: packUrl,
      // The dock gives this document the whole window, so the page is her stage: she stands and
      // walks anywhere on it (`ground: "free"`), and the drop point is wherever you put her.
      ground: "free",
      host: {
        root,
        bounds,
        emit: onEvent,
        sound: () => {},
        // She starts at the bottom right, just above the dock's tile.
        start: { x: stage.W - stage.S * 150, y: stage.floorY },
      },
    });
    apply(answer.state);
    applyArea();
    addEventListener("resize", () => { refreshBox(); body.resize(); });
    ready = true;
    // The dock may have mounted this frame closed (the preload) and said so while the figure
    // was still loading: only a frame someone can see starts its loops.
    if (shown) {
      frameId = requestAnimationFrame(frame);
      startClocks();
    }
  } catch (err) {
    fail(`The pet is not around right now. ${err?.message ?? ""}`);
  }
}

/** Feeding: a double-click fills the whale up from her pantry, and the server keeps the numbers. */
document.addEventListener("dblclick", (e) => {
  if (panelOpen) return;
  const at = docPoint(e);
  if (!onPet(at)) return;
  void feed();
});

start();

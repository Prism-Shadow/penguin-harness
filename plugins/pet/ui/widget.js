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
 * Her menu is a right-click on her (#menu, #shop): the pantry is bought with the coins her
 * owner's Token usage earns (TOKENS_PER_COIN), she can be told how often to talk on her own,
 * and how much of the page she may roam. Both are stored in the same document, so every face
 * of the pet — the CLI's `pet` commands included — sees one pet.
 *
 * The dock mounts this document bare and fills the window with it (no card, no title bar, no
 * close button — the dock's tile opens and closes it), so the page is her stage and the document
 * also answers where the pointer is over her: the handshake below is what keeps the page beneath
 * this frame clickable — her own panels count as "on her", or they could not be clicked at all.
 */

import * as kit from "./figure/kit/body.js";
import { createWhaleBody } from "./figure/whale/figure.js";

const STATE_URL = "/api/plugins/@penguinharness/pet/state";
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

const root = document.getElementById("root");
const bubbleEl = document.getElementById("bubble");
const hud = document.getElementById("hud");
const menuEl = document.getElementById("menu");
const shopEl = document.getElementById("shop");
const menuFood = document.getElementById("menu-food");
const menuShop = document.getElementById("menu-shop");
const shopCoins = document.getElementById("shop-coins");
const shopUsed = document.getElementById("shop-used");
const shopFood = document.getElementById("shop-food");
const shopBuy = document.getElementById("shop-buy");
const shopHint = document.getElementById("shop-hint");
const talkChips = document.getElementById("talk-chips");
const areaChips = document.getElementById("area-chips");

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
let doing = "idle";
let bubbleUntil = 0;

/* ---------- her menu's vocabulary ---------- */

/** How often she speaks on her own: the idle gap, and the label the menu shows. */
const TALKS = {
  off: { label: "静音", idle: 0 },
  rare: { label: "少", idle: 4 * 60_000 },
  normal: { label: "中", idle: 100_000 },
  chatty: { label: "多", idle: 30_000 },
};
let talk = "normal";

/** How much of the page she may roam: the stage box, and whether she wanders at all. */
const AREAS = {
  page: { label: "全页", top: "0", roam: "free" },
  lower: { label: "下半屏", top: "52%", roam: "free" },
  dock: { label: "底部", top: "calc(100% - 240px)", roam: "free" },
  spot: { label: "原地", top: "0", roam: "off" },
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
 */

let over = false;
let pressed = false;
let lastAt = null;

function onPet(at) {
  if (!body || at === null) return false;
  const x = at.x - rootBox.left;
  const y = at.y - rootBox.top;
  return body.layout().hit.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
}

/** Whether a document point is on one of her open panels. */
function onPanel(at) {
  if (at === null) return false;
  for (const el of [menuEl, shopEl]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (at.x >= r.left - 2 && at.x <= r.right + 2 && at.y >= r.top - 2 && at.y <= r.bottom + 2) return true;
  }
  return false;
}

function answered(next) {
  if (next === over) return;
  over = next;
  // The dock is the only parent this document has; posting to itself (opened on its own) is
  // harmless — nothing here acts on the message it sends.
  parent.postMessage({ penguin: "widget-over", over: next }, location.origin);
  // The pointer went back to the page: whatever she had open is dismissed with it.
  if (!next) closePanels();
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const data = e.data;
  if (data === null || typeof data !== "object" || data.penguin !== "widget-probe") return;
  if (typeof data.x !== "number" || typeof data.y !== "number") return;
  lastAt = { x: data.x, y: data.y };
  answered(onPet(lastAt) || onPanel(lastAt));
});

/* ---------- pointer: the document relays to the body ----------
 *
 * The listeners are on the document, not on the stage box: her head is drawn above a low stage
 * box, and a click there must count as a click on her.
 */

document.addEventListener("pointerdown", (e) => {
  if (hud.contains(e.target)) return; // the panels' own controls
  const at = docPoint(e);
  if (onPet(at)) {
    root.setPointerCapture?.(e.pointerId);
    pressed = true;
    body?.pointer("down", stagePoint(e));
  } else {
    closePanels();
  }
});

document.addEventListener("pointermove", (e) => {
  const at = docPoint(e);
  lastAt = at;
  body?.pointer("move", stagePoint(e));
  if (!pressed) answered(onPet(at) || onPanel(at));
});

document.addEventListener("pointerup", (e) => {
  const at = docPoint(e);
  pressed = false;
  body?.pointer("up", stagePoint(e));
  answered(onPet(at) || onPanel(at));
});

document.addEventListener("pointercancel", (e) => {
  pressed = false;
  body?.pointer("cancel", stagePoint(e));
});

document.documentElement.addEventListener("pointerleave", () => {
  body?.pointer("leave", null);
  lastAt = null;
  answered(false);
});

addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanels();
});

/* ---------- her menu ---------- */

let idleAt = 0;

/** Fills a chips row: one button per option, the current one pressed. */
function chips(into, table, current, onPick) {
  into.textContent = "";
  for (const [key, def] of Object.entries(table)) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "chip";
    el.textContent = def.label;
    el.setAttribute("aria-pressed", String(key === current));
    el.addEventListener("click", () => onPick(key));
    into.appendChild(el);
  }
}

function renderMenu() {
  menuFood.textContent = `${food} 份`;
  chips(talkChips, TALKS, talk, (key) => {
    talk = key;
    idleAt = 0;
    renderMenu();
    void patch({ pet: { talk } });
  });
  chips(areaChips, AREAS, area, (key) => {
    area = key;
    applyArea();
    renderMenu();
    void patch({ pet: { area } });
  });
}

function renderShop() {
  shopCoins.textContent = coins.toFixed(1);
  shopUsed.textContent = (mined / TOKENS_PER_COIN).toFixed(1);
  shopFood.textContent = String(food);
  shopBuy.textContent = "";
  for (const n of BUY_AMOUNTS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "btn";
    el.disabled = coins < n;
    el.textContent = `买 ${n} 币 · ${n * PORTIONS_PER_COIN} 份食物`;
    el.addEventListener("click", () => void buy(n));
    shopBuy.appendChild(el);
  }
  shopHint.textContent =
    coins < 1
      ? "每用掉 1M tokens 攒 1 币，聊几句就涨"
      : "双击她投喂 1 份（饱食度 +20）";
}

/** Puts a panel beside a document point, kept inside the window. */
function place(el, at) {
  const pad = 8;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.min(Math.max(pad, at.x + 6), Math.max(pad, innerWidth - w - pad))}px`;
  el.style.top = `${Math.min(Math.max(pad, at.y + 6), Math.max(pad, innerHeight - h - pad))}px`;
}

/** An open panel keeps her still and keeps the frame's pointer: both are "on her". */
function panelsOpen(open) {
  body?.set({ dialogOpen: open });
}

function openMenu(at) {
  shopEl.hidden = true;
  renderMenu();
  menuEl.hidden = false;
  place(menuEl, at);
  panelsOpen(true);
  answered(true);
}

function openShop(at) {
  menuEl.hidden = true;
  renderShop();
  shopEl.hidden = false;
  place(shopEl, at);
  panelsOpen(true);
  answered(true);
}

function closePanels() {
  if (menuEl.hidden && shopEl.hidden) return;
  menuEl.hidden = true;
  shopEl.hidden = true;
  panelsOpen(false);
}

/** Where a panel opens when the click did not come from the page (a hungry double-click). */
function nearHer() {
  const at = lastAt ?? { x: innerWidth / 2, y: innerHeight / 2 };
  return { x: Math.min(innerWidth - 300, at.x), y: Math.min(innerHeight - 240, at.y) };
}

menuShop.addEventListener("click", () => {
  const r = menuShop.getBoundingClientRect();
  openShop({ x: r.left, y: r.bottom + 6 });
});

document.getElementById("shop-close").addEventListener("click", () => closePanels());

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const at = docPoint(e);
  if (onPet(at)) openMenu(at);
  else closePanels();
});

/* ---------- the pantry: feeding, buying, and the coins Token usage earns ---------- */

async function feed() {
  if (!body) return;
  if (food < 1) {
    say(pick(BROKE_LINES));
    openShop(nearHer());
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
}

async function buy(n) {
  if (coins < n) return;
  coins -= n;
  food += n * PORTIONS_PER_COIN;
  say(pick(BUY_LINES));
  renderShop();
  try {
    await patch({ pet: { coins, food } });
  } catch {
    /* the next read reads the truth back */
  }
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
    renderShop();
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
  if (typeof pet.talk === "string" && Object.hasOwn(TALKS, pet.talk) && pet.talk !== talk) {
    talk = pet.talk;
    idleAt = 0;
    if (!menuEl.hidden) renderMenu();
  }
  if (typeof pet.area === "string" && Object.hasOwn(AREAS, pet.area) && pet.area !== area) {
    area = pet.area;
    applyArea();
    if (!menuEl.hidden) renderMenu();
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
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  body.step(dt);
  chatter(now);
  // She walks: a pointer that was on her a moment ago may be over the page again now.
  if (over && !pressed) answered(onPet(lastAt) || onPanel(lastAt));
  const bubble = bubbleEl.textContent && now < bubbleUntil;
  if (bubble) {
    const at = body.layout().bubble;
    bubbleEl.style.left = `${rootBox.left + at.x}px`;
    bubbleEl.style.top = `${rootBox.top + Math.max(18, at.y)}px`;
  } else if (bubbleEl.style.display !== "none") {
    bubbleEl.style.display = "none";
    bubbleEl.textContent = "";
  }
  requestAnimationFrame(frame);
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
    body = await createWhaleBody(new URL("./figure/whale/", import.meta.url), {
      kit,
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
    requestAnimationFrame(frame);
    setInterval(tick, TICK_MS);
    void mine();
    setInterval(mine, MINE_MS);
  } catch (err) {
    fail(`The pet is not around right now. ${err?.message ?? ""}`);
  }
}

/** Feeding: a double-click fills the whale up from her pantry, and the server keeps the numbers. */
document.addEventListener("dblclick", (e) => {
  if (hud.contains(e.target)) return;
  const at = docPoint(e);
  if (!onPet(at)) return;
  void feed();
});

start();

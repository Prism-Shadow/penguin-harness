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
 * however you look at it. Feeding is a double-click: +fullness, PATCHed.
 *
 * The dock mounts this document bare and fills the window with it (no card, no title bar, no
 * close button — the dock's tile opens and closes it), so the page is her stage and the document
 * also answers where the pointer is over her: the handshake below is what keeps the page beneath
 * this frame clickable.
 */

import * as kit from "./figure/kit/body.js";
import { createWhaleBody } from "./figure/whale/figure.js";

const STATE_URL = "/api/plugins/@penguinharness/pet/state";
const TICK_MS = 30_000;
/** Fullness lost per idle tick, and gained per feed. */
const HUNGER = 2;
const FEED = 20;
/** How long a bubble line stays up. */
const BUBBLE_MS = 3400;
/**
 * How tall her figure is on the page, in CSS pixels — the 256-unit square she is drawn in. Fixed,
 * not a share of the window: a pet that grew with the window would tower over a maximized app.
 */
const PET_PX = 280;

const root = document.getElementById("root");
const bubbleEl = document.getElementById("bubble");

let body = null;
let fullness = 0;
let doing = "idle";
let bubbleUntil = 0;

/** The stage the body stands on: the whole page — one logo unit is S pixels, the whale inside a 256-unit square. */
function bounds() {
  const r = root.getBoundingClientRect();
  return { W: r.width, H: r.height, floorY: r.height - 8, S: Math.min(PET_PX, r.height - 24) / 256 };
}

function stagePoint(e) {
  const r = root.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
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

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

function say(text, ms = BUBBLE_MS) {
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
 * circles (layout().hit) are what we check against. The pointer leaving the frame, or walking
 * off her while she is drawn elsewhere, answers false and the page gets its clicks back.
 */

let over = false;
let pressed = false;
let lastAt = null;

function onPet(at) {
  if (!body || at === null) return false;
  return body.layout().hit.some((c) => Math.hypot(at.x - c.x, at.y - c.y) < c.r);
}

function answered(next) {
  if (next === over) return;
  over = next;
  // The dock is the only parent this document has; posting to itself (opened on its own) is
  // harmless — nothing here acts on the message it sends.
  parent.postMessage({ penguin: "widget-over", over: next }, location.origin);
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const data = e.data;
  if (data === null || typeof data !== "object" || data.penguin !== "widget-probe") return;
  if (typeof data.x !== "number" || typeof data.y !== "number") return;
  lastAt = { x: data.x, y: data.y };
  answered(onPet(lastAt));
});

/* ---------- pointer: the stage relays to the body ---------- */

root.addEventListener("pointerdown", (e) => {
  root.setPointerCapture?.(e.pointerId);
  pressed = true;
  body?.pointer("down", stagePoint(e));
});
root.addEventListener("pointermove", (e) => {
  const at = stagePoint(e);
  lastAt = at;
  body?.pointer("move", at);
  if (!pressed) answered(onPet(at));
});
root.addEventListener("pointerup", (e) => {
  const at = stagePoint(e);
  pressed = false;
  body?.pointer("up", at);
  answered(onPet(at));
});
root.addEventListener("pointercancel", (e) => {
  pressed = false;
  body?.pointer("cancel", stagePoint(e));
});
root.addEventListener("pointerleave", () => {
  body?.pointer("leave", null);
  lastAt = null;
  answered(false);
});

/** Feeding: a double-click fills the whale up, and the server keeps the number. */
root.addEventListener("dblclick", async () => {
  if (!body) return;
  body.do("excited");
  say(pick(FEED_LINES));
  fullness = Math.min(100, fullness + FEED);
  try { await patch({ pet: { fullness } }); } catch { /* the next tick reads the truth back */ }
});

/* ---------- server state: read, patch, apply ---------- */

async function read() {
  const res = await fetch(STATE_URL, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`state ${res.status}`);
  return res.json();
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
  if (typeof doc.pet?.fullness === "number") fullness = doc.pet.fullness;
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

let last = 0;
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  body.step(dt);
  // She walks: a pointer that was on her a moment ago may be over the page again now.
  if (over && !pressed) answered(onPet(lastAt));
  const bubble = bubbleEl.textContent && now < bubbleUntil;
  if (bubble) {
    const at = body.layout().bubble;
    bubbleEl.style.left = `${at.x}px`;
    bubbleEl.style.top = `${Math.max(18, at.y)}px`;
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
    addEventListener("resize", () => body.resize());
    requestAnimationFrame(frame);
    setInterval(tick, TICK_MS);
  } catch (err) {
    fail(`The pet is not around right now. ${err?.message ?? ""}`);
  }
}

start();

/**
 * The pet widget's behaviour: poll the state routes, draw the pet, move it with transforms.
 *
 * The pet's document lives at GET/PATCH /api/plugins/<package>/state, same-origin, the
 * user's cookie going along (`credentials: "same-origin"`). The widget is a reader that
 * occasionally writes: an idle tick lowers the fullness a little and PATCHes it back, so the
 * pet grows hungry however you look at it. Everything drawn answers one `doing` value —
 * `idle`, `walk`, `sit`, `sleep`, `eat` — as a transform stepped by requestAnimationFrame
 * (the Coopanion stage's pattern): translate3d only, so the browser composites and nothing
 * repaints.
 */

const STATE_URL = "/api/plugins/@penguinharness/pet/state";
const TICK_MS = 30_000;
/** Fullness lost per idle tick. */
const HUNGER = 2;
const WALK_SPAN = 64;
const EASE = 0.08;

const pet = document.getElementById("pet");
const bar = document.getElementById("fullness");
let bubble = null;
let doing = "idle";
let fullness = 0;
let name = "";

/** The bubble element, made when a line first needs one, dropped when the line goes away. */
function setBubble(text) {
  if (!text && bubble) { bubble.remove(); bubble = null; return; }
  if (!text) return;
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.className = "bubble";
    pet.parentElement.appendChild(bubble);
  }
  bubble.textContent = name ? `${name}: ${text}` : text;
}

function draw() {
  pet.classList.toggle("sleep", doing === "sleep");
  pet.classList.toggle("sit", doing === "sit");
  pet.classList.toggle("eat", doing === "eat");
  bar.style.width = `${fullness}%`;
}

/** One easing loop toward x, the stage pattern: stop scheduling once close enough. */
function glide(from, to, apply) {
  let x = from;
  let frame = 0;
  const step = () => {
    x += (to - x) * EASE;
    if (Math.abs(to - x) < 0.5) { apply(to); return; }
    apply(x);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

let stopWalk = null;
/** A walk: glide to one side, then back, then report done. */
function walk() {
  const base = pet.getBoundingClientRect();
  const cx = 0;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const home = base.left + base.width / 2;
  const away = Math.min(Math.max(home + dir * WALK_SPAN, 40), window.innerWidth - 40) - home;
  const setX = (x) => { pet.style.transform = `translate3d(${x}px, 0, 0)`; };
  setX(cx);
  const half = glide(cx, away, setX);
  setTimeout(() => { half(); glide(away, cx, setX); }, 900);
}

let stopIdle = null;
/** The idle loop: every few seconds pick what the pet does next. */
function idleLoop() {
  if (stopIdle) clearInterval(stopIdle);
  stopIdle = setInterval(() => {
    if (fullness < 20 && doing !== "sleep") { doing = "sleep"; draw(); return; }
    const pick = ["idle", "walk", "sit", "idle"][Math.floor(Math.random() * 4)];
    if (pick === doing) return;
    doing = pick;
    draw();
    if (pick === "walk") walk();
  }, 5000);
}

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

/** One idle tick: the pet grows a little hungry, and the server keeps the document. */
async function tick() {
  if (fullness <= 0) return;
  try {
    const answer = await patch({ pet: { fullness: Math.max(0, fullness - HUNGER) } });
    apply(answer.state);
  } catch { /* the next tick tries again; a widget stays quiet about its failures */ }
}

function apply(state) {
  const doc = state ?? {};
  name = doc.pet?.name ?? "";
  if (typeof doc.pet?.fullness === "number") fullness = doc.pet.fullness;
  if (doc.mood?.doing) doing = doc.mood.doing;
  setBubble(doc.mood?.bubble ?? null);
  draw();
}

async function start() {
  try {
    const answer = await read();
    apply(answer.state);
    document.querySelector(".err")?.remove();
  } catch {
    if (!document.querySelector(".err")) {
      const err = document.createElement("div");
      err.className = "err";
      err.textContent = "The pet is not around right now.";
      document.body.appendChild(err);
    }
    return;
  }
  idleLoop();
  setInterval(tick, TICK_MS);
}

start();

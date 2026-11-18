/**
 * The pet page's behaviour: the stage and the host around a figure drawn by a driver.
 *
 * The driver is a plugin of its own — `pet.figure.driver` in the state names its package —
 * whose `ui/figure.js` this document imports and calls with the stage (./figure/contract.ts
 * is the whole interface, typed). The driver simulates the pet — walking, roaming, sitting,
 * sleeping, being picked up, thrown, touched — and draws each frame however it likes; this
 * document is the host: it hands the driver a stage (bounds, pointer events), relays what the
 * body reports into the speech bubble, and keeps the pet's server state fresh — the same
 * reader-and-occasional-writer contract, at GET/PATCH /api/plugins/<package>/state with the
 * user's cookie (`credentials: "same-origin"`): an idle tick lowers the fullness a little and
 * PATCHes it back, so the pet grows hungry however you look at it. Feeding is a double-click:
 * it eats one portion from the pantry (+fullness), PATCHed.
 *
 * Her dialog is a right-click on her (#panel, ./src/panel.tsx → ./dist by `pnpm build:ui`):
 * the daily签到 and the daily Token graph beside her state and the shop her coins are spent
 * in, and how often she talks and how much of the page she roams. It is the shared UI
 * package's work (React + @prismshadow/penguin-ui) and is loaded on that first right-click,
 * so the preload the opening costs nothing until someone asks for it; this file owns her
 * state and hands the dialog a snapshot to draw. Everything is stored in the same document,
 * so every face of the pet — the CLI's `pet` commands included — sees one pet.
 *
 * The colour scheme is the system's own: this document is a page of the app, so there is no
 * store to read and no parent to agree with — `prefers-color-scheme` is the one source, and
 * the app's own dark class (this document is same-origin with the app's sheet) matches it.
 */

import type { FigureDriverModule, PetFigureInstance } from "./figure/contract";
import type { AreaKey, CheckIn, PetPanel, PetPanelHost, PetSnapshot, TalkKey } from "./src/types";

const STATE_URL = "/api/plugins/@penguinharness/pet/state";
/**
 * The version of this package's `ui/` files, as the server stamped the URL it framed
 * (`?v=`, server: plugin/package.ts). Every file the figure pack loads carries the same
 * query, so the browser keeps them for good instead of re-fetching the whole pack on each
 * open — and an edit under `ui/` moves the stamp, so the URL too.
 */
const VERSION = new URLSearchParams(location.search).get("v") ?? "";

/**
 * The figure driver, as the pet's state names it: `pet.figure.driver` is the package of the
 * plugin whose `ui/figure.js` draws her, `pet.figure.*` the rest of its own configuration
 * (a model pack's path, a scheme) handed to it verbatim. A state without one, or naming a
 * driver that is not installed, leaves her absent — the page stays up, says so, and the
 * state route is where the fix goes.
 *
 * The module is loaded from the driver package's own `ui/`, so it is served by the same
 * route this document is (`GET /api/plugins/<package>/ui/*`) and carries the driver package's
 * own version stamp: the page's stamp is not the driver's, and each file the driver loads
 * beside itself rides the query the driver puts on its own URLs (see contract.ts).
 */
const DRIVER_URL = "/api/plugins";

async function loadDriver(state: { pet?: { figure?: { driver?: unknown } } }): Promise<FigureDriverModule> {
  const figure = state?.pet?.figure;
  const name = typeof figure?.driver === "string" ? figure.driver : "";
  if (name === "") throw new Error("she is not wearing any figure (pet.figure.driver is unset)");
  if (!/^@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
    throw new Error(`not a package name: ${name}`);
  const url = new URL(`${DRIVER_URL}/${encodeURIComponent(name)}/ui/figure.js`, location.href);
  const mod = (await import(url.href)) as Partial<FigureDriverModule>;
  if (typeof mod.createFigure !== "function") throw new Error(`no createFigure in ${name}`);
  return mod as FigureDriverModule;
}

/** The system's own mode — the one answer this page has, being a page and not a dock. */
function isDark(): boolean {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * The app's mode, for the one thing this document paints itself — her speech balloon. The sheet
 * that carries the theme's own tokens is only loaded on the first right-click, and the balloon is
 * up long before that, so the mode is read here from the system and kept live: a mode whose OS
 * flips arrives as a media query. The sheet re-applies the same mode, with the rest of the theme,
 * whenever it is drawn.
 *
 * The outcome is also stamped on `<html>` as `data-penguin-dark`, because the dialog's module
 * (`./src`) runs in this same document and applies the theme through the package's own pre-paint
 * script: that script only knows the system, so it reads this attribute to agree with it.
 */
function applyScheme() {
  const dark = isDark();
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.penguinDark = dark ? "dark" : "light";
  // A driver whose own palette follows the mode (the kit's does through the attribute above,
  // a Cubism pack's through its palettes) hears it here; one that does not, ignores it.
  body?.set({ dark });
}

applyScheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyScheme);

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

const root = document.getElementById("root") as HTMLElement;
const bubbleEl = document.getElementById("bubble") as HTMLElement;
/** Where the dialog's React tree is mounted (empty until the first right-click). */
const panelRoot = document.getElementById("panel") as HTMLElement;

let body: PetFigureInstance | null = null;
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
let checkin: CheckIn = { last: "", streak: 0 };
let doing = "idle";
let bubbleUntil = 0;

/* ---------- her menu's vocabulary ---------- */

/** How often she speaks on her own: the idle gap between one line and the next. */
const TALKS: Record<TalkKey, { idle: number }> = {
  off: { idle: 0 },
  rare: { idle: 4 * 60_000 },
  normal: { idle: 100_000 },
  chatty: { idle: 30_000 },
};
let talk: TalkKey = "normal";

/** How much of the page she may roam: the stage box, and whether she wanders at all. */
const AREAS: Record<AreaKey, { top: string; roam: "free" | "off" }> = {
  page: { top: "0", roam: "free" },
  lower: { top: "52%", roam: "free" },
  dock: { top: "calc(100% - 240px)", roam: "free" },
  spot: { top: "0", roam: "off" },
};
let area: AreaKey = "page";

/** Where the stage box sits in this document, so a stage point and a document point convert. */
let rootBox = { left: 0, top: 0 };

/** The stage the body stands on: the whole page — one logo unit is S pixels, the pet inside a 256-unit square. */
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
  rootBox = { left: r.left, top: r.top };
}

function docPoint(e: PointerEvent | MouseEvent) {
  return { x: e.clientX, y: e.clientY };
}

/** A document point in the stage's own pixels (the stage box need not start at 0,0). */
function stagePoint(e: PointerEvent | MouseEvent) {
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

const TOUCH_LINES: Record<string, readonly string[]> = {
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

function pick(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0]!;
}

/**
 * Puts the balloon on the anchor her own body reports. It is moved with `translate`, not
 * `left`/`top`: she walks while a line is up, so the balloon is placed on every frame, and a
 * positioned box that changes `left`/`top` is a layout change the browser counts (and repaints
 * the page for) — a balloon following her head would score as a layout shift over and over, and
 * the first frame after a line lands would flash it at the document's corner, where it sits
 * until the next frame places it. A translate is a paint-time move: same pixels, no layout.
 */
function placeBubble() {
  if (!body) return;
  const at = body.layout().bubble;
  bubbleEl.style.translate = `${rootBox.left + at.x}px ${rootBox.top + Math.max(18, at.y)}px`;
}

/** One line in the bubble. A muted pet says nothing — not the reactions either. */
function say(text: string, ms = BUBBLE_MS) {
  if (talk === "off") return;
  bubbleEl.textContent = text;
  // Placed before it is shown: the loop would place it a frame later, and the one frame in
  // between is a balloon at the corner of the page.
  placeBubble();
  // `#bubble` is `display: none` until she has something to say, and the empty string falls back
  // to that rule rather than overriding it — the balloon has to be given a display of its own.
  bubbleEl.style.display = "block";
  bubbleUntil = performance.now() + ms;
  body?.talk?.();
}

/** The kit's events, minus the ones nothing here answers. */
function onEvent(kind: string, detail: unknown) {
  if (
    kind === "touch" &&
    typeof detail === "object" &&
    detail !== null &&
    "kind" in detail &&
    typeof detail.kind === "string" &&
    TOUCH_LINES[detail.kind]
  ) {
    say(pick(TOUCH_LINES[detail.kind]!));
  }
}

/* ---------- pointer: the document relays to the body ----------
 *
 * The listeners are on the document, not on the stage box: her head is drawn above a low stage
 * box, and a click there must count as a click on her.
 */

let pressed = false;

function onPet(at: { x: number; y: number } | null): boolean {
  if (!body || at === null) return false;
  const x = at.x - rootBox.left;
  const y = at.y - rootBox.top;
  return body.layout().hit.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
}

document.addEventListener("pointerdown", (e) => {
  // A sheet owns every pointer it gets: the stage only takes events while it is free, and the
  // scrim under a dialog is the dialog's own (it dismisses on a click, not the stage).
  if (sheetOpen()) return;
  if (onPet(docPoint(e))) {
    root.setPointerCapture?.(e.pointerId);
    pressed = true;
    body?.pointer("down", stagePoint(e));
  }
});

document.addEventListener("pointermove", (e) => {
  if (sheetOpen()) return;
  body?.pointer("move", stagePoint(e));
});

document.addEventListener("pointerup", (e) => {
  if (sheetOpen()) return;
  pressed = false;
  body?.pointer("up", stagePoint(e));
});

document.addEventListener("pointercancel", (e) => {
  pressed = false;
  body?.pointer("cancel", stagePoint(e));
});

document.documentElement.addEventListener("pointerleave", () => {
  if (sheetOpen()) return; // a sheet stays up while the pointer is out of the window
  body?.pointer("leave", null);
});

/* ---------- her dialog: the shared UI package's panel, loaded on demand ---------- */

let idleAt = 0;

/** Whether one of her surfaces is up — the dialog or the quick menu. */
function sheetOpen(): boolean {
  return panelOpen || menuOpen;
}

/** An open sheet keeps her still: she must not walk out from under the hand using it. */
function panelsOpen(open: boolean) {
  body?.set({ dialogOpen: open });
}

/** The pet, as her dialog draws it (ui/src/types.ts: PetSnapshot). */
function snapshot(): PetSnapshot {
  return {
    name: "",
    fullness,
    food: Math.floor(food),
    coins,
    mined,
    gift,
    talk,
    area,
    checkin,
  };
}

/** A file beside this document, under the version stamp it was framed with (see VERSION). */
function uiUrl(path: string) {
  const url = new URL(path, import.meta.url);
  if (VERSION !== "") url.search = `?v=${encodeURIComponent(VERSION)}`;
  return url.href;
}

/** The dialog's sheet, in before it is drawn: a dialog that landed unstyled would flash. */
let sheet: Promise<void> | null = null;
function loadSheet(): Promise<void> {
  sheet ??= new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = uiUrl("./panel.css");
    link.dataset.petPanel = "";
    link.addEventListener("load", () => resolve());
    link.addEventListener("error", () => reject(new Error(`panel.css ${link.href}`)));
    document.head.append(link);
  });
  return sheet;
}

/** The dialog module, as the bundle hands it back; stays null until the first right-click. */
interface PetPanelModule {
  mountPetPanel(root: HTMLElement, host: PetPanelHost): PetPanel;
}

/** The dialog module and the handle it hands back; both stay null until the first right-click. */
let panel: PetPanel | null = null;
let loading: Promise<unknown> | null = null;

/**
 * Fetches the dialog's two files once her figure is up, so the first right-click does not pay for
 * them. Nothing is mounted, styled or run: this only puts the bytes in the browser's cache, where
 * the import and the `<link>` that follow will find them (under the stamp they are immutable, so
 * a hit is not even revalidated). After the figure on purpose — it is the bigger download, and
 * the one someone is waiting for.
 */
function warmPanel() {
  // A metered or save-data connection asked not to be loaded ahead of time.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData === true) return;
  for (const file of ["./panel.js", "./panel.css"]) {
    void fetch(uiUrl(file), { credentials: "same-origin" })
      .then((res) => res.arrayBuffer())
      .catch(() => {});
  }
}

/** Loads the dialog once: its sheet, then the module — React and the UI package ride inside it. */
function ensurePanel(): Promise<unknown> {
  loading ??= Promise.all([loadSheet(), import(uiUrl("./panel.js")) as Promise<PetPanelModule>])
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
        openDialog: () => void openPanel(),
        // The chat is the app's, not this document's: the menu only asks for it.
        openChat: () => {
          closeSheet();
          parent.postMessage({ penguin: "pet-chat-open" }, location.origin);
        },
        closeMenu,
      } satisfies PetPanelHost);
    })
    .catch((err: unknown) => {
      loading = null;
      fail(`她的小店没开起来。${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });
  return loading;
}

/** A load already under way (a second right-click while the bundle is in flight). */
let opening = false;

/** Which of the two surfaces is up — the dialog and the quick menu never show together. */
let panelOpen = false;
let menuOpen = false;

/** Loads the bundle both surfaces share, once. False when it could not be had. */
async function openBundle(): Promise<boolean> {
  if (opening) return false;
  opening = true;
  try {
    await ensurePanel();
    return true;
  } catch {
    return false;
  } finally {
    opening = false;
  }
}

/** Hands the surface that is up the current numbers; a closed one keeps nothing. */
function pushSnapshot() {
  if (panelOpen) panel?.update(snapshot());
  else if (menuOpen) panel?.updateMenu(snapshot());
}

/** The dialog: her day, the graph, her state and the shop. */
async function openPanel() {
  // A menu may be what asked for it (its shop row), so only a dialog already up stops this.
  if (panelOpen) return;
  if (!(await openBundle())) return;
  // The menu it was opened from goes in the same breath: closing it separately would leave the
  // pointer on a sheet nobody sees, and the page would take the dialog down with it.
  if (menuOpen) {
    menuOpen = false;
    panel?.closeMenu();
  }
  panelOpen = true;
  panelsOpen(true);
  panel?.open(snapshot());
}

function closePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  panel?.close();
  if (!menuOpen) panelsOpen(false);
}

/** The quick menu: her pantry and her two habits, at the point a secondary click landed. */
async function openMenu(at: { x: number; y: number }) {
  if (sheetOpen()) return;
  if (!(await openBundle())) return;
  menuOpen = true;
  panelsOpen(true);
  panel?.menu(at, snapshot());
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  panel?.closeMenu();
  if (!panelOpen) panelsOpen(false);
}

/** Every surface goes at once: a click on the page away from her, or the quick menu's own word. */
function closeSheet() {
  closeMenu();
  closePanel();
}

/* ---------- her habits: how often she talks, how much of the page she roams ---------- */

async function setTalk(key: TalkKey) {
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

async function setArea(key: AreaKey) {
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
function dayKey(at: Date) {
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
    food = before.food;
    coins = before.coins;
    checkin = before.checkin;
    pushSnapshot();
  }
}

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const at = docPoint(e);
  if (onPet(at)) void openMenu(at);
  else closeSheet();
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

async function buy(n: number) {
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
    const projects = (await readJson("/api/projects")) as {
      projects?: Array<{ projectId: string }>;
    };
    let lifetime = 0;
    for (const p of projects.projects ?? []) {
      const totals = (await readJson(
        `/api/projects/${encodeURIComponent(p.projectId)}/usage/model-totals`,
      )) as { totals?: Array<{ tokens?: unknown }> };
      for (const t of totals.totals ?? []) {
        if (typeof t.tokens === "number") lifetime += t.tokens;
      }
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

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function read(): Promise<{ state?: unknown; pet?: { figure?: { driver?: unknown } } }> {
  return (await readJson(STATE_URL)) as { state?: unknown; pet?: { figure?: { driver?: unknown } } };
}

async function patch(update: Record<string, unknown>): Promise<{ state?: unknown }> {
  const res = await fetch(STATE_URL, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`patch ${res.status}`);
  return (await res.json()) as { state?: unknown };
}

/** A wish from the state document the body acts on once: external orders beat roaming for a while. */
function wish(next: string) {
  if (!body || next === doing) return;
  doing = next;
  if (next === "walk") body.walk(bounds().W * (0.2 + Math.random() * 0.6));
  else if (next === "sit") body.do("sit");
  else if (next === "sleep") body.do("sleep");
  else if (next === "eat") {
    body.do("excited");
    say("好好吃！");
  } else body.do("stand");
}

function apply(state: unknown) {
  const doc = (state ?? {}) as {
    pet?: Record<string, unknown>;
    mood?: { doing?: unknown; bubble?: unknown };
  };
  const pet = doc.pet ?? {};
  if (typeof pet.fullness === "number") fullness = pet.fullness;
  if (typeof pet.food === "number") food = pet.food;
  if (typeof pet.coins === "number") coins = pet.coins;
  if (typeof pet.mined === "number") mined = pet.mined;
  if (typeof pet.gift === "boolean") gift = pet.gift;
  if (
    typeof pet.talk === "string" &&
    Object.hasOwn(TALKS, pet.talk) &&
    (pet.talk as TalkKey) !== talk
  ) {
    talk = pet.talk as TalkKey;
    idleAt = 0;
  }
  if (
    typeof pet.area === "string" &&
    Object.hasOwn(AREAS, pet.area) &&
    (pet.area as AreaKey) !== area
  ) {
    area = pet.area as AreaKey;
    applyArea();
  }
  if (pet.checkin !== null && typeof pet.checkin === "object") {
    const stored = pet.checkin as { last?: unknown; streak?: unknown };
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
  if (typeof doc.mood?.doing === "string") wish(doc.mood.doing);
  if (typeof doc.mood?.bubble === "string") say(doc.mood.bubble);
  pushSnapshot();
}

/** One idle tick: the pet grows a little hungry, and the server keeps the document. */
async function tick() {
  if (fullness <= 0) {
    if (body && Math.random() < 0.5) say(pick(HUNGRY_LINES));
    return;
  }
  try {
    const answer = await patch({ pet: { fullness: Math.max(0, fullness - HUNGER) } });
    apply(answer.state);
    if (fullness < 15 && Math.random() < 0.5) {
      body?.do("sad");
      say(pick(HUNGRY_LINES));
    }
  } catch {
    /* the next tick tries again; a page stays quiet about its failures */
  }
}

/* ---------- the frame loop ---------- */

/** Her own chatter: one line per gap, only while the page is in front of someone. */
function chatter(now: number) {
  const gap = TALKS[talk]?.idle ?? 0;
  if (!gap) {
    idleAt = 0;
    return;
  }
  if (!idleAt) {
    idleAt = now + gap;
    return;
  }
  if (now < idleAt) return;
  idleAt = now + gap * (0.75 + Math.random() * 0.5);
  if (document.hidden) return;
  say(fullness < 30 ? pick(HUNGRY_LINES) : pick(MUSINGS));
}

let last = 0;
function frame(now: number) {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  body?.step(dt);
  chatter(now);
  const bubble = bubbleEl.textContent && now < bubbleUntil;
  if (bubble) {
    placeBubble();
  } else if (bubbleEl.style.display !== "none") {
    bubbleEl.style.display = "none";
    bubbleEl.textContent = "";
  }
  requestAnimationFrame(frame);
}

/** The two clocks that write her state: hunger beside the pack's own eating, and the Token waterline. */
function startClocks() {
  // Nothing ticks before her state is read and the figure is up: a tick against a state that
  // has not arrived yet would patch over it, and mining would count the whole history at once.
  setInterval(tick, TICK_MS);
  void mine();
  setInterval(mine, MINE_MS);
}

function fail(message: string) {
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
    // The driver draws her and moves her; the stage hands it the window, the pointer relay
    // and the two callbacks (its touches, its lines) — the contract (./figure/contract.ts)
    // is everything either side may ask of the other, and this call is its whole surface.
    const driver = await loadDriver(answer);
    body = await driver.createFigure(
      {
        root,
        bounds,
        emit: onEvent,
        talk: () => body?.talk?.(),
        // She starts at the bottom right, just above the entry control.
        start: { x: stage.W - stage.S * 150, y: stage.floorY },
      },
      {
        url: new URL("./", import.meta.url).href,
        figure: answer.pet?.figure,
        dark: isDark,
      },
    );
    apply(answer.state);
    applyArea();
    addEventListener("resize", () => {
      refreshBox();
      body?.resize();
    });
    // Her figure is up, so the link is free for the one thing a press would still wait on.
    warmPanel();
    requestAnimationFrame(frame);
    startClocks();
  } catch (err) {
    fail(`The pet is not around right now. ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Feeding: a double-click fills the pet up from her pantry, and the server keeps the numbers. */
document.addEventListener("dblclick", (e) => {
  if (sheetOpen()) return;
  if (!onPet(docPoint(e))) return;
  void feed();
});

start();

/* Piggy Sticker World: the game. Views, the studio's pointer handling, goals, levels, the blind
   box, saved works and export. Progress lives in localStorage under zz_* keys, which
   storage-bridge.js keeps with the workbench; every text comes from i18n.js through T(). */
const T = window.PigletI18n.t;
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
};
const SIZES = { pig: 200, furn: 210, plant: 150, food: 120, deco: 110, nat: 150, life: 120 };
const FACES = ["happy", "open", "wink", "sleepy", "closed", "star"];
/* Daily themes: theme.1 … theme.12 in i18n.js. */
const THEME_COUNT = 12;
const stName = (st) => T("stk." + st.id);
const stDesc = (st) => (st.cat === "pig" ? T("desc." + st.id) : "");
const catName = (id) => T("cat." + id);
const sceneName = (id) => T("scene." + (SCENES.find((x) => x.id === id) || SCENES[0]).id);
const levelName = (lv) => T("level." + lv.id);
const levelTip = (lv) => T("level." + lv.id + ".tip");
const dateLocale = () => T("date.locale");
/* The language switch: shown on every page, it flips the language and redraws in place. */
const langBtn = (cls) =>
  `<button class="${cls}" data-act="lang" aria-label="${esc(T("lang.switchLabel"))}" title="${esc(T("lang.switchLabel"))}">${esc(T("lang.switch"))}</button>`;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m],
  );
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let uidc = 0;
const newUid = () => "u" + (++uidc).toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Stars and today's goals (texts: goal.<id>) ---------- */
const GOAL_DEFS = [
  { id: "items6", need: 6, val: () => (S ? S.doc.items.length : 0) },
  {
    id: "pigs3",
    need: 3,
    val: () =>
      S
        ? new Set(S.doc.items.filter((i) => (BY_ID[i.sid] || {}).cat === "pig").map((i) => i.sid))
            .size
        : 0,
  },
  {
    id: "mix",
    need: 2,
    val: () =>
      S
        ? ["furn", "plant"].filter((c) => S.doc.items.some((i) => (BY_ID[i.sid] || {}).cat === c))
            .length
        : 0,
  },
  {
    id: "cats3",
    need: 3,
    val: () => (S ? new Set(S.doc.items.map((i) => (BY_ID[i.sid] || {}).cat)).size : 0),
  },
  { id: "save", need: 1, flag: "save" },
  { id: "box", need: 1, flag: "box" },
  { id: "scene", need: 1, flag: "scene" },
  { id: "rename", need: 1, flag: "rename" },
  {
    id: "theme",
    need: 5,
    dyn: true,
    text: (d) => T("goal.theme", sceneName(d.scene)),
    val: (d) => (S && S.doc.scene === d.scene ? S.doc.items.length : 0),
  },
];
function stars() {
  return Number(LS.get("zz_stars", 0)) || 0;
}
function addStars(n) {
  LS.set("zz_stars", stars() + n);
}
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function daily() {
  const k = todayKey();
  let d = LS.get("zz_daily", null);
  if (!d || d.d !== k) {
    const seed = Number(k.replace(/-/g, "")) || 1;
    const themeIdx = GOAL_DEFS.findIndex((g) => g.id === "theme");
    const order = GOAL_DEFS.map((g, i) => i)
      .filter((i) => i !== themeIdx)
      .sort((a, b) => ((seed * (a + 3)) % 97) - ((seed * (b + 3)) % 97));
    const sceneId = SCENES[(seed % (SCENES.length - 1)) + 1].id; /* skips the blank canvas */
    d = {
      d: k,
      scene: sceneId,
      ids: ["theme"].concat(order.slice(0, 2).map((i) => GOAL_DEFS[i].id)),
      flags: {},
      done: [],
    };
    LS.set("zz_daily", d);
  }
  if (!d.done) d.done = [];
  if (!d.flags) d.flags = {};
  return d;
}
function goalVal(g, d) {
  return g.flag ? d.flags[g.flag] || 0 : g.val(d);
}
function goalList() {
  const d = daily();
  return d.ids.map((id) => {
    const g = GOAL_DEFS.find((x) => x.id === id) || { id, need: 1, val: () => 0 };
    const v = Math.min(g.need, goalVal(g, d));
    const text = typeof g.text === "function" ? g.text(d) : T("goal." + g.id);
    return { g: Object.assign({}, g, { text }), v, done: d.done.includes(id) || v >= g.need };
  });
}
function flagGoal(name) {
  const d = daily();
  d.flags[name] = (d.flags[name] || 0) + 1;
  LS.set("zz_daily", d);
  checkGoals();
}
function checkGoals() {
  const d = daily();
  const s0 = stars();
  let earned = 0;
  goalList().forEach(({ g, done }) => {
    if (done && !d.done.includes(g.id)) {
      d.done.push(g.id);
      earned++;
      addStars(1);
    }
  });
  if (earned) {
    LS.set("zz_daily", d);
    const left = d.ids.filter((id) => !d.done.includes(id)).length;
    toast(left ? T("toast.goalDone", earned, left) : T("toast.goalsAll"));
    if (!left) addStars(1);
    beep(940, 0.12, 0.05);
    const s1 = stars();
    const unlocked = PIGS.filter((p) => p.star && s0 < p.star && s1 >= p.star);
    unlocked.forEach((p) => toast(T("toast.unlocked", stName(p))));
    if (unlocked.length) {
      const tray = document.getElementById("tray");
      if (tray) tray.innerHTML = trayHTML();
    }
    refreshGoalUI();
  }
}
function refreshGoalUI() {
  const host = document.querySelector("[data-goalbox]");
  if (host) host.innerHTML = goalsCardHTML(true);
  const st = document.querySelector("[data-star]");
  if (st) st.textContent = stars();
}
function goalsCardHTML(compact) {
  const list = goalList();
  const done = list.filter((x) => x.done).length;
  const rows = list
    .map(({ g, v, done }) => {
      const pct = Math.round((v / g.need) * 100);
      return `<div class="g-row${done ? " ok" : ""}">
      <span class="g-check">${done ? "✓" : "○"}</span>
      <span class="g-txt">${esc(g.text)}</span>
      <span class="g-bar"><i style="width:${pct}%"></i></span>
    </div>`;
    })
    .join("");
  if (compact)
    return (
      `<div class="g-head"><span class="tag">${esc(T("goals.title"))}</span><span class="g-num">${done}/${list.length}</span>` +
      `<span class="g-star">${I.star}<b data-star>${stars()}</b></span></div><div class="g-list">${rows}</div>`
    );
  return rows;
}

/* Icons */
const I = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="ic-star"><path d="M12 3.6l2.6 5.6 6 .7-4.5 4.1 1.3 5.9L12 16.9l-5.4 3 1.3-5.9L3.4 9.9l6-.7z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 0 3-6"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 1-3-6"/></svg>',
  scene:
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 14h8v6H8z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 12l4 4 4-4"/><path d="M4 19h16"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1"/></svg>',
  flip: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7L4 12l4 5z"/><path d="M16 7l4 5-4 5z"/></svg>',
  rot: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-3-6"/><path d="M20 5v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  downl: '<svg viewBox="0 0 24 24"><path d="M12 5v13M6 12l6 6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock:
    '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7-2"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-9.3C5 7.7 7 6 9.2 6c1.5 0 2.4.9 2.8 1.6C12.4 6.9 13.3 6 14.8 6 17 6 19 7.7 19 10.7 19 15.4 12 20 12 20z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="12" cy="12" r="1.2"/></svg>',
  magic:
    '<svg viewBox="0 0 24 24"><path d="M5 19l9-9"/><path d="M14 5l2 2-3 3-2-2z"/><path d="M18 12l1.5 3L23 16l-3.5 1L18 20l-1.5-3L13 16l3.5-1z"/></svg>',
  face: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="9.5" cy="10.5" r="1"/><circle cx="14.5" cy="10.5" r="1"/><path d="M9.5 15c1.6 1.2 3.4 1.2 5 0"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24"><path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const A = { page: "home", cat: "pig", query: "", favsOnly: false };
let S = null;

/* ---------- Sound ---------- */
let AC = null;
function beep(f, d, vol) {
  if (LS.get("zz_sound", true) === false) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(),
      g = AC.createGain();
    o.type = "sine";
    o.frequency.value = f || 660;
    g.gain.value = vol || 0.04;
    o.connect(g);
    g.connect(AC.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0008, AC.currentTime + (d || 0.09));
    o.stop(AC.currentTime + (d || 0.09) + 0.02);
  } catch (e) {}
}

/* ---------- Toasts ---------- */
let toastTimer = null;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1700);
}

/* ---------- Dialogs ---------- */
function modal(html, onOpen) {
  document.querySelectorAll(".mask").forEach((x) => x.remove()); /* one dialog at a time */
  const m = document.createElement("div");
  m.className = "mask";
  m.innerHTML = `<div class="modal">${html}</div>`;
  m.addEventListener("click", (e) => {
    if (e.target === m) m.remove();
  });
  document.body.appendChild(m);
  if (onOpen) onOpen(m);
  return m;
}
function closeModal() {
  const m = document.querySelector(".mask");
  if (m) m.remove();
}

/* ---------- Home ---------- */
function todayTheme() {
  const d = new Date();
  const idx = (d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % THEME_COUNT;
  return T("theme." + (idx + 1));
}
function homeView() {
  const heroPigs = ["pig1", "pig8", "pig12"]
    .map((id) => `<div class="hero-pig">${stickerSVG(BY_ID[id])}</div>`)
    .join("");
  const mg = ["pig3", "plant6", "food3", "deco5", "nat1", "life22"]
    .map((id) => stickerSVG(BY_ID[id]))
    .join("");
  const draft = LS.get("zz_draft", null);
  return `<div class="page home">
    <div class="home-inner">
      <div class="home-top">${langBtn("chip lang-chip")}</div>
      <div class="hero">
        <div class="tape t1"></div><div class="tape t2"></div>
        <div class="hero-blob" style="width:130px;height:130px;left:-38px;top:-30px;background:rgba(249,230,166,.5)"></div>
        <div class="hero-blob" style="width:96px;height:96px;right:10px;top:74px;background:rgba(207,228,244,.55)"></div>
        <div class="spark" style="left:11%;top:15%">${star(50, 50, 38, "#F6C9A5")}</div>
        <div class="spark" style="right:14%;top:11%;animation-delay:-1.4s">${heart(50, 50, 3, "#F7B8C6")}</div>
        <div class="hero-badge">${esc(T("home.badge"))}</div>
        <div class="title">${T("home.titleHtml")}</div>
        <div class="subtitle">${esc(T("home.subtitle"))}</div>
        <div class="hero-pigs">${heroPigs}</div>
      </div>
      <div class="home-btns">
        <button class="btn" data-act="start">${esc(T("home.start"))}</button>
        <button class="btn ghost" data-act="works">${esc(T("home.works"))}</button>
        <button class="btn ghost" data-act="catalog">${esc(T("home.catalog"))}</button>
      </div>
      <div class="today" data-act="theme">
        <span class="tag">${esc(T("home.themeTag"))}</span>
        <span class="txt">${esc((goalList().find((x) => x.g.id === "theme") || { g: { text: todayTheme() } }).g.text)}</span>
        <span class="arrow">›</span>
      </div>
      <div class="goals-card" data-act="goals" data-goalbox>${goalsCardHTML(true)}</div>
      <div class="lv-entry" data-act="levels">
        <span class="lv-entry-pic">${(SCENES.find((s) => s.id === (LEVELS[0] || {}).scene) || SCENES[0]).svg}<i>${stickerSVG(BY_ID["pig3"])}</i></span>
        <div class="lv-entry-body">
          <div class="lv-entry-t">${esc(T("home.levels"))}<small>${levelsDone().length}/${LEVELS.length}</small></div>
          <div class="lv-entry-s">${esc(T("home.levelsSub"))}</div>
        </div>
        <span class="arrow">›</span>
      </div>
      <div class="mini-gallery">
        <div class="mg-title">${T("home.galleryHtml", STICKERS.length)}</div>
        <div class="mg-strip">${mg}</div>
      </div>
      <div class="home-btns" style="gap:9px">
        <button class="chip" data-act="blindbox">${I.dice} ${esc(T("home.blindbox"))}</button>
        <button class="chip" data-act="draft">${I.sparkle} ${esc(T(draft ? "home.resume" : "home.browse"))}</button>
        <button class="chip" data-act="sound">${LS.get("zz_sound", true) === false ? "🔇" : "🔊"} ${esc(T("home.sound"))}</button>
      </div>
      <div class="home-foot">${esc(T("home.foot", STICKERS.length, SCENES.length, gotList().length))}</div>
    </div>
  </div>`;
}

/* ---------- Studio ---------- */
function itemHTML(it) {
  const st = BY_ID[it.sid];
  const size = SIZES[st.cat] * it.s;
  const tf = `translate(-50%,-50%) rotate(${it.rot}deg) scaleX(${it.flip ? -1 : 1})`;
  const bd = ((it.uid.charCodeAt(1) * 7) % 23) / 10;
  return `<div class="item" data-uid="${it.uid}" style="left:${it.x}px;top:${it.y}px;width:${size}px;height:${size}px;--tf:${tf};--bd:${bd}s;transform:var(--tf)">${stickerSVG(st, "", it)}</div>`;
}
/* ---------- Theme levels (names and tips: level.<id>, level.<id>.tip) ---------- */
const LEVELS = [
  { id: "L1", scene: "garden", stars: 2, need: { pig: 2, furn: 2 } },
  { id: "L2", scene: "beach", stars: 2, need: { pig: 2, food: 2 } },
  { id: "L3", scene: "forest", stars: 2, need: { pig: 2, plant: 2, deco: 1 } },
  { id: "L4", scene: "cafe", stars: 2, need: { food: 4, furn: 1 } },
  { id: "L5", scene: "flowershop", stars: 2, need: { plant: 4, deco: 2 } },
  { id: "L6", scene: "bath", stars: 2, need: { life: 2, deco: 2 } },
  { id: "L7", scene: "balcony", stars: 2, need: { plant: 3, furn: 1, pig: 1 } },
  { id: "L8", scene: "kitchen", stars: 2, need: { food: 3, furn: 2 } },
  { id: "L9", scene: "xmas", stars: 2, need: { deco: 3, pig: 1 } },
  { id: "L10", scene: "starry", stars: 3, need: { pig: 3, deco: 2, plant: 1, food: 1 } },
];
function levelsDone() {
  const v = LS.get("zz_levels", []);
  return Array.isArray(v) ? v : [];
}
function levelCount(cat) {
  return S ? S.doc.items.filter((i) => (BY_ID[i.sid] || {}).cat === cat).length : 0;
}
function levelProgress(lv) {
  const need = Object.keys(lv.need).map((k) => ({
    cat: k,
    need: lv.need[k],
    got: Math.min(lv.need[k], levelCount(k)),
  }));
  return { need, ok: need.every((n) => n.got >= n.need) };
}
function checkLevel() {
  if (!S || !S.doc.level) return;
  const lv = LEVELS.find((x) => x.id === S.doc.level);
  if (!lv) return;
  const done = levelsDone();
  const { need, ok } = levelProgress(lv);
  const banner = document.getElementById("lvbar");
  if (banner) banner.innerHTML = levelBarHTML(lv, need, ok || done.includes(lv.id));
  if (!ok || done.includes(lv.id)) return;
  done.push(lv.id);
  LS.set("zz_levels", done);
  addStars(lv.stars);
  refreshGoalUI();
  toast(T("toast.levelDone", levelName(lv), lv.stars));
  beep(980, 0.14, 0.06);
  const tray = document.getElementById("tray");
  if (tray) tray.innerHTML = trayHTML();
  if (banner) banner.innerHTML = levelBarHTML(lv, need, true);
}
function levelBarHTML(lv, need, ok) {
  if (ok) {
    const nx = LEVELS[LEVELS.indexOf(lv) + 1];
    return (
      `<span class="lv-name">✓ ${esc(T("level.cleared", levelName(lv)))}</span><span class="lv-star">★${lv.stars}</span>` +
      (nx
        ? `<button class="lv-next" data-act="playlevel" data-id="${nx.id}">${esc(T("level.next"))}</button>`
        : `<span class="lv-need">${esc(levelsDone().length >= LEVELS.length ? T("level.allDone") : T("level.doneCount", levelsDone().length, LEVELS.length))}</span>`)
    );
  }
  const parts = need.map((n) => `${esc(catName(n.cat))} ${n.got}/${n.need}`).join(" · ");
  return (
    `<span class="lv-name">${esc(levelName(lv))}</span><span class="lv-need">${parts}</span>` +
    `<span class="lv-star">★${lv.stars}</span>`
  );
}
function levelsView() {
  const done = levelsDone();
  return `<div class="page">
    <div class="topbar">
      <button class="iconbtn" data-act="home" title="${esc(T("studio.home"))}">${I.back}</button>
      <div class="name">${esc(T("home.levels"))}<small>${esc(T("levels.sub", done.length, LEVELS.length, stars()))}</small></div>
      <button class="iconbtn" data-act="goals" title="${esc(T("goals.title"))}">${I.star}</button>
      ${langBtn("iconbtn lang-btn")}
    </div>
    <div class="levels">
      ${LEVELS.map((lv, i) => {
        const ok = done.includes(lv.id);
        const sc = SCENES.find((x) => x.id === lv.scene) || SCENES[0];
        const need = Object.keys(lv.need)
          .map((k) => `${esc(catName(k))}×${lv.need[k]}`)
          .join(" ");
        return `<button class="level${ok ? " done" : ""}" data-act="playlevel" data-id="${lv.id}">
          <span class="lv-no">${String(i + 1).padStart(2, "0")}</span>
          <div class="lv-pic">${sc.svg}</div>
          <div class="lv-body">
            <div class="lv-title">${esc(levelName(lv))}</div>
            <div class="lv-desc">${esc(levelTip(lv))}</div>
            <div class="lv-tags"><span>${esc(sceneName(sc.id))}</span><span>${need}</span></div>
          </div>
          <span class="lv-flag">${ok ? "★" + lv.stars : "★" + lv.stars}</span>
        </button>`;
      }).join("")}
    </div>
  </div>`;
}

/* ---------- Limited stickers and the goals dialog ---------- */
function isLocked(st) {
  return !!st.star && stars() < st.star;
}
function lockedTag(st) {
  return `<span class="lk">${I.lock}<i>★${st.star}</i></span>`;
}
function goalsModal() {
  const limited = PIGS.filter((p) => p.star);
  modal(`<h3>${esc(T("goals.title"))}</h3>
    <p class="g-sub">${T("goals.subHtml", stars())}</p>
    <div class="goals-card big">${goalsCardHTML(false)}</div>
    <div class="lim-row">${limited
      .map((p) => {
        const lk = isLocked(p);
        return `<div class="lim${lk ? " lk-on" : ""}">
        <div class="lim-pic">${stickerSVG(p)}</div>
        <div class="lim-name">${lk ? I.lock + " ★" + p.star : esc(stName(p))}</div>
      </div>`;
      })
      .join("")}</div>
    <div class="modal-acts"><button class="btn" data-act="close">${esc(T("common.ok"))}</button></div>`);
}

function trayHTML() {
  const list = STICKERS.filter((s) => s.cat === A.cat);
  return `<div class="tray-top">
      ${CATS.map((c) => `<button class="chip ${A.cat === c.id ? "on" : ""}" data-act="cat" data-cat="${c.id}">${esc(catName(c.id))}</button>`).join("")}
      <span style="flex:1"></span>
      <button class="chip" data-act="blindbox" title="${esc(T("home.blindbox"))}" aria-label="${esc(T("home.blindbox"))}">${I.dice}</button>
      <button class="chip" data-act="inspire" title="${esc(T("tray.inspire"))}" aria-label="${esc(T("tray.inspire"))}">${I.magic}</button>
    </div>
    <div class="strip">${list.map((s) => `<button class="stk${isLocked(s) ? " locked" : ""}" data-act="add" data-sid="${s.id}" title="${esc(stName(s))}" aria-label="${esc(stName(s))}">${stickerSVG(s)}${isLocked(s) ? lockedTag(s) : ""}</button>`).join("")}</div>`;
}
function studioView() {
  const sc = SCENES.find((s) => s.id === S.doc.scene) || SCENES[0];
  const lv = S.doc.level ? LEVELS.find((x) => x.id === S.doc.level) : null;
  const lvHtml = lv
    ? (() => {
        const pg = levelProgress(lv);
        return `<div class="lvbar" id="lvbar">${levelBarHTML(lv, pg.need, pg.ok || levelsDone().includes(lv.id))}</div>`;
      })()
    : "";
  return `<div class="studio">
    <div class="topbar">
      <button class="iconbtn" data-act="home" title="${esc(T("studio.home"))}" aria-label="${esc(T("studio.home"))}">${I.back}</button>
      <div class="name" data-act="rename" title="${esc(T("studio.rename"))}">${esc(S.doc.name)}<small>${esc(sceneName(sc.id) + " · " + T("studio.count", S.doc.items.length))}</small></div>
      <button class="iconbtn" data-act="undo" ${S.hist.length ? "" : "disabled"} title="${esc(T("studio.undo"))}" aria-label="${esc(T("studio.undo"))}">${I.undo}</button>
      <button class="iconbtn" data-act="redo" ${S.future.length ? "" : "disabled"} title="${esc(T("studio.redo"))}" aria-label="${esc(T("studio.redo"))}">${I.redo}</button>
      <button class="iconbtn" data-act="scene" title="${esc(T("studio.scene"))}" aria-label="${esc(T("studio.scene"))}">${I.scene}</button>
      <button class="iconbtn" data-act="save" title="${esc(T("studio.save"))}" aria-label="${esc(T("studio.save"))}">${I.save}</button>
      <button class="iconbtn" data-act="export" title="${esc(T("studio.export"))}" aria-label="${esc(T("studio.export"))}">${I.down}</button>
      ${langBtn("iconbtn lang-btn")}
    </div>
    <div class="stage-wrap">
      ${lvHtml}
      <div class="stage-holder" id="holder">
        <div class="stage" id="stage">
          <div class="bg" id="bg">${sc.svg}</div>
          <div class="items" id="items"></div>
          <div class="selbox" id="selbox" style="display:none"><span class="h nw" data-h="nw"></span><span class="h ne" data-h="ne"></span><span class="h sw" data-h="sw"></span><span class="h se" data-h="se"></span></div>
          <div class="guide v" id="gv"></div>
          <div class="guide h" id="gh"></div>
        </div>
      </div>
      <button class="goal-fab" data-act="goals" title="${esc(T("goals.title"))}">${I.star}<b data-star>${stars()}</b></button>
      <div id="itembar"></div>
    </div>
    <div class="tray" id="tray">${trayHTML()}</div>
  </div>`;
}

/* Opening the studio */
function openStudio(opts) {
  opts = opts || {};
  const doc = opts.doc
    ? JSON.parse(JSON.stringify(opts.doc))
    : { name: T("work.untitled"), scene: "pinkroom", items: [] };
  if (!doc.items) doc.items = [];
  S = {
    doc,
    docId: opts.docId || null,
    sel: null,
    hist: [],
    future: [],
    k: 1,
    justAdded: null,
    pinch: null,
    drag: null,
    scale: null,
  };
  pts.clear();
  A.page = "studio";
  render();
}

/* Rendering and interaction */
function render() {
  const app = document.getElementById("app");
  if (A.page === "home") {
    app.innerHTML = homeView();
  } else if (A.page === "works") {
    app.innerHTML = worksView();
  } else if (A.page === "catalog") {
    app.innerHTML = catalogView();
  } else if (A.page === "levels") {
    app.innerHTML = levelsView();
  } else if (A.page === "studio") {
    app.innerHTML = studioView();
    afterStudio();
  }
}
function afterStudio() {
  const stage = document.getElementById("stage");
  renderItems();
  refreshSel();
  fitStage();
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("dblclick", (e) => {
    const el = e.target.closest(".item");
    if (!el) return;
    const it = S.doc.items.find((i) => i.uid === el.dataset.uid);
    if (it && BY_ID[it.sid].cat === "pig") cycleFace(it);
  });
}
function fitStage() {
  const wrap = document.querySelector(".stage-wrap"),
    holder = document.getElementById("holder");
  if (!wrap || !holder) return;
  const bar = document.getElementById("lvbar");
  const w = wrap.clientWidth - 22,
    h = wrap.clientHeight - 22 - (bar ? bar.offsetHeight + 8 : 0);
  const k = Math.max(0.12, Math.min(w, h) / 900);
  holder.style.width = 900 * k + "px";
  holder.style.height = 900 * k + "px";
  document.getElementById("stage").style.transform = `scale(${k})`;
  S.k = k;
}
function renderItems() {
  const host = document.getElementById("items");
  if (!host) return;
  host.innerHTML = S.doc.items.map(itemHTML).join("");
  if (S.justAdded) {
    const el = host.querySelector(`.item[data-uid="${S.justAdded}"]`);
    if (el) {
      el.classList.add("popin");
      setTimeout(() => el.classList.remove("popin"), 420);
    }
    S.justAdded = null;
  }
  const sub = document.querySelector(".topbar .name small");
  if (sub) {
    const sc = SCENES.find((s) => s.id === S.doc.scene) || SCENES[0];
    sub.textContent = sceneName(sc.id) + " · " + T("studio.count", S.doc.items.length);
  }
  checkLevel();
}
function selItem() {
  return S && S.doc.items.find((i) => i.uid === S.sel);
}
function refreshSel() {
  const box = document.getElementById("selbox"),
    bar = document.getElementById("itembar");
  const it = selItem();
  if (!it) {
    if (box) box.style.display = "none";
    if (bar) bar.innerHTML = "";
    return;
  }
  const st = BY_ID[it.sid],
    size = SIZES[st.cat] * it.s;
  if (!box) return; /* the studio is not on the page yet: nothing to place */
  box.style.display = "block";
  box.style.left = it.x + "px";
  box.style.top = it.y + "px";
  box.style.width = size + 10 + "px";
  box.style.height = size + 10 + "px";
  box.style.transform = `translate(-50%,-50%) rotate(${it.rot}deg)`;
  /* the stage is scaled by S.k, so the handles grow by its inverse to stay easy to hit */
  box.style.setProperty("--hs", (26 / (S.k || 1)).toFixed(2) + "px");
  box.classList.toggle("locked", !!it.locked);
  if (bar) bar.innerHTML = itemBarHTML(it, st);
}
function itemBarHTML(it, st) {
  const b = (act, icon, title, cls) =>
    `<button data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}" class="${cls || ""}">${icon}</button>`;
  return `<div class="item-bar" style="position:static;max-width:100%;overflow-x:auto">
    <span style="font-size:12px;font-weight:800;color:#A08A80;padding:0 8px;align-self:center;white-space:nowrap">${esc(stName(st))}</span>
    ${st.cat === "pig" ? b("face", I.face, T("item.face")) : ""}
    ${b("bigger", I.plus, T("item.bigger"))}${b("smaller", I.minus, T("item.smaller"))}${b("rotate", I.rot, T("item.rotate"))}${b("flip", I.flip, T("item.flip"))}
    ${b("layerup", I.up, T("item.layerUp"))}${b("layerdown", I.downl, T("item.layerDown"))}${b("dupe", I.copy, T("item.dupe"))}
    ${b("lock", it.locked ? I.unlock : I.lock, T(it.locked ? "item.unlock" : "item.lock"))}
    ${b("del", I.trash, T("item.del"), "del")}
  </div>`;
}

/* History */
function snapshot() {
  return JSON.stringify(S.doc.items);
}
function pushHist() {
  S.hist.push(snapshot());
  if (S.hist.length > 60) S.hist.shift();
  S.future = [];
  syncHistBtns();
}
function syncHistBtns() {
  const u = document.querySelector('.topbar [data-act="undo"]'),
    r = document.querySelector('.topbar [data-act="redo"]');
  if (u) u.disabled = !S.hist.length;
  if (r) r.disabled = !S.future.length;
}
function undo() {
  if (!S.hist.length) return;
  S.future.push(snapshot());
  S.doc.items = JSON.parse(S.hist.pop());
  if (!S.doc.items.some((i) => i.uid === S.sel)) S.sel = null;
  renderItems();
  refreshSel();
  saveDraft();
  syncHistBtns();
  beep(380, 0.07, 0.03);
}
function redo() {
  if (!S.future.length) return;
  S.hist.push(snapshot());
  S.doc.items = JSON.parse(S.future.pop());
  renderItems();
  refreshSel();
  saveDraft();
  syncHistBtns();
  beep(520, 0.07, 0.03);
}
function saveDraft() {
  if (S)
    LS.set("zz_draft", {
      name: S.doc.name,
      scene: S.doc.scene,
      items: S.doc.items,
      docId: S.docId,
      ts: Date.now(),
    });
}

/* Adding and removing */
/* A spot that does not cover a sticker already placed */
function spotFor() {
  const items = S.doc.items;
  const taken = (p) => items.some((i) => Math.hypot(i.x - p.x, i.y - p.y) < 135);
  for (let i = 0; i < 36; i++) {
    const a = Math.random() * Math.PI * 2,
      d = 120 + Math.random() * 150;
    const p = {
      x: Math.min(780, Math.max(120, 450 + Math.cos(a) * d)),
      y: Math.min(800, Math.max(140, 460 + Math.sin(a) * d)),
    };
    if (!taken(p)) return p;
  }
  return { x: 450 + rnd(-110, 110), y: 470 + rnd(-80, 80) };
}
function addSticker(sid, pos) {
  const st = BY_ID[sid];
  if (!st) return;
  if (isLocked(st)) {
    toast(T("toast.needStars", st.star - stars(), stName(st)));
    beep(300, 0.1, 0.03);
    return;
  }
  pushHist();
  const spot = pos || spotFor();
  const it = {
    uid: newUid(),
    sid,
    x: spot.x,
    y: spot.y,
    s: 1,
    rot: 0,
    flip: 0,
    locked: 0,
  };
  S.doc.items.push(it);
  S.sel = it.uid;
  S.justAdded = it.uid;
  renderItems();
  refreshSel();
  saveDraft();
  checkGoals();
  heartsAt(it);
  beep(st.cat === "pig" ? 720 : 620, 0.08, 0.035);
}
function delItem(uid) {
  const idx = S.doc.items.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const el = document.querySelector(`.item[data-uid="${uid}"]`);
  pushHist();
  if (el) {
    el.style.transition = "transform .18s ease, opacity .18s ease";
    el.style.transform = "var(--tf) scale(.25)";
    el.style.opacity = "0";
  }
  setTimeout(() => {
    S.doc.items.splice(idx, 1);
    if (S.sel === uid) S.sel = null;
    renderItems();
    refreshSel();
    saveDraft();
  }, 170);
  beep(300, 0.1, 0.03);
}

/* Sticker reactions */
function heartsAt(it) {
  const stage = document.getElementById("stage");
  if (!stage) return;
  const wrap = stage.parentElement.parentElement;
  const r = stage.getBoundingClientRect(),
    wr = wrap.getBoundingClientRect();
  const px = (it.x / 900) * r.width + (r.left - wr.left);
  const py = (it.y / 900) * r.height + (r.top - wr.top);
  for (let i = 0; i < 3; i++) {
    const h = document.createElement("div");
    h.className = "fly-heart";
    h.textContent = pick(["❤", "♡", "✿", "★"]);
    h.style.left = px + rnd(-40, 40) + "px";
    h.style.top = py - 30 + "px";
    h.style.animationDelay = i * 0.08 + "s";
    h.style.color = pick(["#F5A9BC", "#F3C6A8", "#F6C9A5", "#C4DDCB"]);
    wrap.appendChild(h);
    setTimeout(() => h.remove(), 1200);
  }
}

/* Pointer handling */
function toLogical(e) {
  const r = document.getElementById("stage").getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 900, y: ((e.clientY - r.top) / r.height) * 900 };
}
const pts = new Map();
function onDown(e) {
  /* first: was a corner resize handle grabbed? */
  const hd = e.target.closest && e.target.closest(".selbox .h");
  if (hd && S.sel) {
    e.preventDefault();
    const it = selItem();
    if (it) {
      if (it.locked) {
        toast(T("toast.locked"));
        return;
      }
      const sign = hd.dataset.h;
      S.scale = {
        uid: it.uid,
        ax: sign === "ne" || sign === "se" ? 1 : -1,
        ay: sign === "sw" || sign === "se" ? 1 : -1,
        snap: snapshot(),
        moved: 0,
        pushed: false,
      };
      hd.classList.add("on");
      try {
        document.getElementById("stage").setPointerCapture(e.pointerId);
      } catch (err) {}
      beep(640, 0.05, 0.02);
    }
    return;
  }
  const el = e.target.closest(".item");
  const p = toLogical(e);
  pts.set(e.pointerId, p);
  if (el) {
    const it = S.doc.items.find((i) => i.uid === el.dataset.uid);
    if (!it) return;
    if (S.sel !== it.uid) {
      S.sel = it.uid;
      refreshSel();
    }
    if (it.locked) {
      toast(T("toast.locked"));
      return;
    }
    if (pts.size === 1) {
      S.drag = { uid: it.uid, dx: it.x - p.x, dy: it.y - p.y, moved: 0, snap: snapshot() };
      el.classList.add("dragging");
      try {
        document.getElementById("stage").setPointerCapture(e.pointerId);
      } catch (err) {}
    } else if (pts.size === 2) {
      startPinch(it.uid, el);
    }
  } else if (pts.size === 1) {
    S.drag = null;
  }
}
function startPinch(uid, el) {
  const arr = [...pts.values()];
  const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) || 1;
  const a = (Math.atan2(arr[1].y - arr[0].y, arr[1].x - arr[0].x) * 180) / Math.PI;
  const it = S.doc.items.find((i) => i.uid === uid);
  pushHist();
  S.pinch = { uid, d0: d, a0: a, s0: it.s, r0: it.rot };
  S.drag = null;
}
function onMove(e) {
  if (!pts.has(e.pointerId) && !S.drag && !S.scale) return;
  const p = toLogical(e);
  if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
  if (S.pinch && pts.size >= 2) {
    const arr = [...pts.values()];
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) || 1;
    const a = (Math.atan2(arr[1].y - arr[0].y, arr[1].x - arr[0].x) * 180) / Math.PI;
    const it = S.doc.items.find((i) => i.uid === S.pinch.uid);
    if (!it) return;
    const k = d / S.pinch.d0;
    it.s = Math.min(4, Math.max(0.25, S.pinch.s0 * k));
    it.rot = Math.round(S.pinch.r0 + (a - S.pinch.a0));
    updateItemDOM(it);
    refreshSel();
    return;
  }
  if (S.scale) {
    applyScale(p);
    return;
  }
  if (!S.drag) return;
  const it = S.doc.items.find((i) => i.uid === S.drag.uid);
  if (!it) return;
  const nx = p.x + S.drag.dx,
    ny = p.y + S.drag.dy;
  S.drag.moved += Math.abs(nx - it.x) + Math.abs(ny - it.y);
  if (!S.drag.pushed && S.drag.moved > 5) {
    S.hist.push(S.drag.snap);
    if (S.hist.length > 60) S.hist.shift();
    S.future = [];
    syncHistBtns();
    S.drag.pushed = true;
  }
  let sx = Math.min(960, Math.max(-60, nx)),
    sy = Math.min(960, Math.max(-60, ny));
  const gv = document.getElementById("gv"),
    gh = document.getElementById("gh");
  const snapX = Math.abs(sx - 450) < 16,
    snapY = Math.abs(sy - 450) < 16;
  if (snapX) sx = 450;
  if (snapY) sy = 450;
  if (gv) gv.classList.toggle("on", snapX);
  if (gh) gh.classList.toggle("on", snapY);
  it.x = sx;
  it.y = sy;
  updateItemDOM(it);
  refreshSel();
}
/* Corner resize: the opposite corner stays put and the sticker scales evenly; a rotated sticker is measured in its own frame */
function applyScale(p) {
  const sc = S.scale;
  if (!sc) return;
  const it = S.doc.items.find((i) => i.uid === sc.uid);
  if (!it) return;
  const st = BY_ID[it.sid];
  if (!st) return;
  const base = SIZES[st.cat];
  const th = (it.rot * Math.PI) / 180,
    cos = Math.cos(th),
    sin = Math.sin(th);
  const dx = p.x - it.x,
    dy = p.y - it.y;
  const ux = dx * cos + dy * sin,
    uy = -dx * sin + dy * cos; /* back into the sticker's own frame */
  const hNew = Math.max(
    10,
    (sc.ax * ux + sc.ay * uy) / 2,
  ); /* half the side, from the point projected on the diagonal */
  const sNew = Math.min(4, Math.max(0.25, (2 * hNew - 10) / base));
  if (Math.abs(sNew - it.s) < 0.001) return;
  sc.moved += Math.abs(sNew - it.s) * 100;
  if (!sc.pushed && sc.moved > 1) {
    S.hist.push(sc.snap);
    if (S.hist.length > 60) S.hist.shift();
    S.future = [];
    syncHistBtns();
    sc.pushed = true;
  }
  const hO = (base * it.s + 10) / 2,
    hN = (base * sNew + 10) / 2,
    d = hN - hO;
  it.s = sNew;
  const lx = sc.ax * d,
    ly = sc.ay * d; /* keep the opposite corner fixed; the centre follows */
  it.x = Math.min(1000, Math.max(-100, it.x + lx * cos - ly * sin));
  it.y = Math.min(1000, Math.max(-100, it.y + lx * sin + ly * cos));
  updateItemDOM(it);
  refreshSel();
}
function updateItemDOM(it) {
  const el = document.querySelector(`.item[data-uid="${it.uid}"]`);
  if (!el) return;
  const size = SIZES[BY_ID[it.sid].cat] * it.s;
  const tf = `translate(-50%,-50%) rotate(${it.rot}deg) scaleX(${it.flip ? -1 : 1})`;
  el.style.left = it.x + "px";
  el.style.top = it.y + "px";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.style.setProperty("--tf", tf);
  el.style.transform = tf;
}
function onUp(e) {
  pts.delete(e.pointerId);
  if (S.scale) {
    document.querySelectorAll(".selbox .h.on").forEach((x) => x.classList.remove("on"));
    if (S.scale.pushed) beep(860, 0.06, 0.03);
    S.scale = null;
    saveDraft();
    refreshSel();
  }
  if (S.pinch && pts.size < 2) {
    S.pinch = null;
    saveDraft();
    refreshSel();
  }
  if (S.drag) {
    const it = S.doc.items.find((i) => i.uid === S.drag.uid);
    const el = document.querySelector(`.item[data-uid="${S.drag.uid}"]`);
    if (el) el.classList.remove("dragging");
    const gv = document.getElementById("gv"),
      gh = document.getElementById("gh");
    if (gv) gv.classList.remove("on");
    if (gh) gh.classList.remove("on");
    if (it && S.drag.moved < 6) {
      el && el.classList.add("wiggle");
      setTimeout(() => el && el.classList.remove("wiggle"), 520);
      heartsAt(it);
      beep(760, 0.06, 0.03);
    }
    S.drag = null;
    saveDraft();
  }
}
function onWheel(e) {
  const it = selItem();
  if (!it || it.locked) return;
  e.preventDefault();
  if (e.shiftKey) it.rot += e.deltaY > 0 ? 8 : -8;
  else it.s = Math.min(4, Math.max(0.25, it.s * (e.deltaY > 0 ? 0.94 : 1.06)));
  updateItemDOM(it);
  refreshSel();
  saveDraft();
}
function cycleFace(it) {
  const st = BY_ID[it.sid];
  if (!st.opts) return;
  const cur = it.face || st.opts.eyes || "open";
  const idx = FACES.indexOf(cur);
  it.face = FACES[(idx + 1) % FACES.length];
  const el = document.querySelector(`.item[data-uid="${it.uid}"]`);
  if (el) {
    el.innerHTML = stickerSVG(st, "", it);
    el.classList.add("wiggle");
    setTimeout(() => el.classList.remove("wiggle"), 520);
  }
  refreshSel();
  saveDraft();
  beep(700, 0.06, 0.03);
}

/* Item actions */
function selAct(act) {
  const it = selItem();
  if (!it) return;
  if (it.locked && act !== "lock") {
    toast(T("toast.unlockFirst"));
    return;
  }
  const st = BY_ID[it.sid];
  switch (act) {
    case "bigger":
      pushHist();
      it.s = Math.min(4, it.s * 1.14);
      break;
    case "smaller":
      pushHist();
      it.s = Math.max(0.25, it.s / 1.14);
      break;
    case "rotate":
      pushHist();
      it.rot = (it.rot + 15) % 360;
      break;
    case "flip":
      pushHist();
      it.flip = it.flip ? 0 : 1;
      break;
    case "dupe": {
      pushHist();
      const cp = Object.assign({}, it, { uid: newUid(), x: it.x + 34, y: it.y + 34 });
      S.doc.items.push(cp);
      S.sel = cp.uid;
      S.justAdded = cp.uid;
      renderItems();
      refreshSel();
      saveDraft();
      beep(660, 0.08, 0.03);
      return;
    }
    case "layerup": {
      pushHist();
      const i = S.doc.items.findIndex((x) => x.uid === it.uid);
      if (i < S.doc.items.length - 1) {
        S.doc.items.splice(i, 1);
        S.doc.items.splice(i + 1, 0, it);
      }
      break;
    }
    case "layerdown": {
      pushHist();
      const i = S.doc.items.findIndex((x) => x.uid === it.uid);
      if (i > 0) {
        S.doc.items.splice(i, 1);
        S.doc.items.splice(i - 1, 0, it);
      }
      break;
    }
    case "lock":
      it.locked = it.locked ? 0 : 1;
      toast(T(it.locked ? "toast.lockOn" : "toast.lockOff"));
      break;
    case "face":
      cycleFace(it);
      return;
    case "del":
      delItem(it.uid);
      return;
  }
  renderItems();
  refreshSel();
  saveDraft();
  beep(600, 0.05, 0.025);
}

/* Choosing a scene */
function sceneModal() {
  const cur = S ? S.doc.scene : "pinkroom";
  modal(
    `<h3>${esc(T("scene.pick"))}</h3>
    <div class="scene-grid">
      ${SCENES.map(
        (
          s,
        ) => `<button class="scene-card ${s.id === cur ? "on" : ""}" data-act="setscene" data-scene="${s.id}">
        ${s.svg}<span>${esc(sceneName(s.id))}</span></button>`,
      ).join("")}
    </div>`,
    (m) => {
      m.addEventListener("click", (e) => {
        const b = e.target.closest('[data-act="setscene"]');
        if (!b) return;
        if (!S || A.page !== "studio") {
          S = {
            doc: { name: T("work.untitled"), scene: b.dataset.scene, items: [] },
            docId: null,
            sel: null,
            hist: [],
            future: [],
            k: 1,
          };
          pts.clear();
          A.page = "studio";
          closeModal();
          render();
          return;
        }
        pushHist();
        S.doc.scene = b.dataset.scene;
        closeModal();
        renderItems();
        saveDraft();
        flagGoal("scene");
        document.getElementById("bg").innerHTML = SCENES.find((x) => x.id === b.dataset.scene).svg;
        renderItems();
        refreshSel();
        toast(T("toast.sceneChanged"));
      });
    },
  );
}

/* Saving */
function saveModal() {
  const cur = S.doc.name;
  modal(
    `<h3>${esc(T("save.title"))}</h3>
    <input class="field" id="wname" maxlength="24" value="${esc(cur)}" placeholder="${esc(T("save.placeholder"))}">
    <div class="modal-acts">
      <button class="btn ghost" data-act="close">${esc(T("common.later"))}</button>
      <button class="btn" data-act="dosave">${esc(T("save.do"))}</button>
    </div>`,
    (m) => {
      const inp = m.querySelector("#wname");
      setTimeout(() => {
        inp.focus();
        inp.select();
      }, 60);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSave();
      });
      m.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="close"]')) closeModal();
        if (e.target.closest('[data-act="dosave"]')) doSave();
      });
    },
  );
}
async function doSave() {
  const inp = document.getElementById("wname");
  const name = (inp && inp.value.trim()) || T("work.untitled");
  S.doc.name = name;
  closeModal();
  /* No PNG thumbnail in the record: every work lives in the one zz_works value, and a PNG data
     URL per work would take it past the storage bridge's 512 KB per value after a few works,
     after which the list would stop reaching the server. The works page draws each thumbnail
     from the work itself (workThumb). */
  const works = LS.get("zz_works", []);
  const rec = {
    id: S.docId || "w" + Date.now(),
    name,
    scene: S.doc.scene,
    items: S.doc.items,
    ts: Date.now(),
  };
  const idx = works.findIndex((w) => w.id === rec.id);
  if (idx >= 0) works[idx] = rec;
  else works.unshift(rec);
  LS.set("zz_works", works);
  S.docId = rec.id;
  LS.set("zz_draft", null);
  flagGoal("save");
  const nm = document.querySelector(".topbar .name");
  if (nm) nm.firstChild.textContent = name;
  toast(T("toast.saved"));
  beep(880, 0.12, 0.04);
}

/* SVG and PNG output */
function docSVG(doc, w) {
  const sc = SCENES.find((s) => s.id === doc.scene) || SCENES[0];
  const body = sc.svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  const items = doc.items
    .map((it) => {
      const st = BY_ID[it.sid];
      if (!st) return "";
      const size = SIZES[st.cat] * it.s;
      const inner = innerFor(it);
      return `<g transform="translate(${it.x},${it.y}) rotate(${it.rot}) scale(${it.flip ? -1 : 1},1)">
      <g transform="translate(${-size / 2},${-size / 2}) scale(${size / 100})">${inner}</g></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" width="${w}" height="${w}">${body}${items}</svg>`;
}
/* A saved work's thumbnail, drawn from its own scene and stickers. Shown as an <img>, so the SVG
   runs no script and loads nothing. */
function workThumb(w) {
  const doc = { scene: w.scene, items: Array.isArray(w.items) ? w.items : [] };
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(docSVG(doc, 360));
}
function rasterize(svg, w, h) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        res(cv.toDataURL("image/png"));
      } catch (e) {
        res("");
      }
    };
    img.onerror = () => res("");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
async function exportDoc(doc, name) {
  toast(T("toast.exporting"));
  const data = await rasterize(docSVG(doc, 1600), 1600, 1600);
  if (!data) {
    toast(T("toast.exportFailed"));
    return;
  }
  const a = document.createElement("a");
  a.href = data;
  a.download = (name || T("export.defaultName")) + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast(T("toast.exported"));
}

/* Blind box: stickers not collected yet first, then ones not on the canvas */
function gotList() {
  const g = LS.get("zz_got", []);
  return Array.isArray(g) ? g : [];
}
function blindbox() {
  const got = gotList();
  const onCanvas = S ? S.doc.items.map((i) => i.sid) : [];
  const free = STICKERS.filter((s) => !isLocked(s));
  const tiers = [
    free.filter((s) => !got.includes(s.id)),
    free.filter((s) => !onCanvas.includes(s.id)),
    free.slice(),
  ];
  const picks = [];
  for (const pool of tiers) {
    const rest = pool.filter((s) => !picks.includes(s));
    while (picks.length < 3 && rest.length)
      picks.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
    if (picks.length >= 3) break;
  }
  const isNew = (s) => !got.includes(s.id);
  const total = STICKERS.length,
    had = got.length,
    newCount = picks.filter(isNew).length;
  const left = total - had;
  const sub = left > 0 ? T("box.subHtml", newCount, left) : esc(T("box.complete"));
  modal(
    `<h3>${esc(T("box.title"))}</h3>
    <p style="text-align:center;color:#A08A80;font-size:13px;margin:-8px 0 12px">${sub}</p>
    <div class="box3">${picks.map((s) => `<div class="b${isNew(s) ? " fresh" : ""}">${stickerSVG(s)}${isNew(s) ? `<span class="tag">${esc(T("box.new"))}</span>` : `<span class="tag old">${esc(T("box.had"))}</span>`}</div>`).join("")}</div>
    <div class="collect">
      <div class="cbar"><i style="width:${Math.round((had / total) * 100)}%"></i></div>
      <div class="cnum">${esc(T("box.collected", had, total))}</div>
    </div>
    <div style="text-align:center;font-weight:800;margin-top:2px;font-size:13px">${picks.map((s) => esc(stName(s))).join(" · ")}</div>
    <div class="modal-acts">
      <button class="btn ghost" data-act="close">${esc(T("box.keep"))}</button>
      <button class="btn" data-act="take">${esc(T("common.place"))}</button>
    </div>`,
    (m) => {
      m.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="close"]')) closeModal();
        if (e.target.closest('[data-act="take"]')) {
          if (!S) {
            S = {
              doc: { name: T("work.untitled"), scene: "pinkroom", items: [] },
              docId: null,
              sel: null,
              hist: [],
              future: [],
              k: 1,
            };
            A.page = "studio";
          }
          A.page = "studio";
          closeModal();
          if (!document.getElementById("stage")) render(); /* the stage first, then the stickers */
          const g = gotList();
          picks.forEach((s) => {
            if (!g.includes(s.id)) g.push(s.id);
          });
          LS.set("zz_got", g);
          picks.forEach((s, i) => addSticker(s.id, { x: 300 + i * 150, y: 470 + (i % 2) * 70 }));
          render();
          toast(newCount ? T("toast.boxNew", newCount) : T("toast.boxPlaced"));
          flagGoal("box");
        }
      });
    },
  );
}

/* One-click arrangement */
function autoCompose() {
  const slots = [
    { cat: "furn", x: 300, y: 320, s: 1.15 },
    { cat: "plant", x: 740, y: 300, s: 1.2 },
    { cat: "deco", x: 150, y: 190, s: 1.1 },
    { cat: "pig", x: 320, y: 560, s: 1.15 },
    { cat: "pig", x: 630, y: 590, s: 1.0 },
    { cat: "plant", x: 130, y: 560, s: 1.0 },
    { cat: "food", x: 500, y: 700, s: 1.0 },
    { cat: "deco", x: 790, y: 520, s: 1.2 },
    { cat: "deco", x: 210, y: 380, s: 1.0 },
  ];
  pushHist();
  S.doc.items = [];
  slots.forEach((sl) => {
    const pool = STICKERS.filter((x) => x.cat === sl.cat);
    const s = pick(pool);
    S.doc.items.push({
      uid: newUid(),
      sid: s.id,
      x: sl.x + rnd(-24, 24),
      y: sl.y + rnd(-24, 24),
      s: sl.s,
      rot: rnd(-6, 6),
      flip: Math.random() < 0.5 ? 1 : 0,
      locked: 0,
    });
  });
  S.sel = null;
  renderItems();
  refreshSel();
  saveDraft();
  toast(T("toast.inspired"));
  beep(820, 0.12, 0.04);
}

/* ---------- My works ---------- */
function worksView() {
  const works = LS.get("zz_works", []);
  return `<div class="page">
    <div class="topbar">
      <button class="iconbtn" data-act="home" title="${esc(T("studio.home"))}" aria-label="${esc(T("studio.home"))}">${I.back}</button>
      <div class="name">${esc(T("home.works"))}<small>${esc(T("works.count", works.length))}</small></div>
      <button class="iconbtn" data-act="start" title="${esc(T("home.start"))}" aria-label="${esc(T("home.start"))}">${I.plus}</button>
      ${langBtn("iconbtn lang-btn")}
    </div>
    <div class="works">
      ${
        works.length
          ? `<div class="works-grid">${works
              .map(
                (w) => `
        <div class="work">
          <img class="thumb" src="${workThumb(w)}" alt="${esc(w.name)}">
          <div class="meta">${esc(w.name)}</div>
          <div class="time">${new Date(w.ts).toLocaleString(dateLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
          <div class="acts">
            <button data-act="editwork" data-id="${w.id}">${esc(T("works.edit"))}</button>
            <button data-act="copywork" data-id="${w.id}">${esc(T("works.copy"))}</button>
            <button data-act="expwork" data-id="${w.id}">${esc(T("works.export"))}</button>
            <button data-act="delwork" data-id="${w.id}">${esc(T("works.delete"))}</button>
          </div>
        </div>`,
              )
              .join("")}</div>`
          : `<div class="empty">${stickerSVG(BY_ID["pig4"])}
          <div style="font-weight:800;color:#A08A80">${esc(T("works.empty"))}</div>
          <div style="font-size:13px">${esc(T("works.emptyHint"))}</div>
          <button class="btn small" data-act="start">${esc(T("home.start"))}</button></div>`
      }
    </div>
  </div>`;
}

/* ---------- Sticker book ---------- */
function catalogView() {
  const favs = LS.get("zz_favs", []);
  const q = (A.query || "").trim().toLowerCase();
  let list = q ? STICKERS.slice() : STICKERS.filter((s) => s.cat === A.cat);
  if (A.favsOnly) list = list.filter((s) => favs.includes(s.id));
  if (q) list = list.filter((s) => (stName(s) + stDesc(s)).toLowerCase().includes(q));
  return `<div class="page">
    <div class="topbar">
      <button class="iconbtn" data-act="home" title="${esc(T("studio.home"))}" aria-label="${esc(T("studio.home"))}">${I.back}</button>
      <div class="name">${esc(T("home.catalog"))}<small>${esc(T("catalog.sub", PIGS.length, STICKERS.length))}</small></div>
      <button class="iconbtn ${A.favsOnly ? "on" : ""}" data-act="favfilter" title="${esc(T("catalog.favs"))}" aria-label="${esc(T("catalog.favs"))}">${I.heart}</button>
      ${langBtn("iconbtn lang-btn")}
    </div>
    <div class="catalog">
      <div class="search">${I.search}<input id="q" placeholder="${esc(T("catalog.search"))}" value="${esc(A.query)}"></div>
      <div class="tray-top" style="margin:0">
        ${CATS.map((c) => `<button class="chip ${A.cat === c.id ? "on" : ""}" data-act="cat" data-cat="${c.id}">${esc(catName(c.id))}</button>`).join("")}
      </div>
      ${
        list.length
          ? `<div class="cat-grid">${list
              .map(
                (s) => `
        <button class="cat-item${isLocked(s) ? " locked" : ""}" data-act="detail" data-sid="${s.id}">
          <div class="pic">${stickerSVG(s)}</div>
          <div class="nm">${esc(isLocked(s) ? T("catalog.unlock", s.star) : stName(s))}</div>
          <span class="fav ${favs.includes(s.id) ? "on" : ""}">♥</span>
          ${isLocked(s) ? lockedTag(s) : ""}
        </button>`,
              )
              .join("")}</div>`
          : `<div class="empty"><div>${esc(T("catalog.empty"))}</div></div>`
      }
    </div>
  </div>`;
}
function detailModal(sid) {
  const s = BY_ID[sid];
  if (!s) return;
  const favs = LS.get("zz_favs", []);
  const on = favs.includes(sid);
  modal(
    `<h3 style="margin-bottom:6px">${esc(stName(s))}</h3>
    <div style="display:grid;place-items:center;margin:2px 0 6px"><div style="width:170px;height:170px">${stickerSVG(s)}</div></div>
    <p style="text-align:center;color:#A08A80;font-size:13.5px;margin:0 0 6px">${esc(stDesc(s) || T("detail.fallback", catName(s.cat)))}</p>
    <div class="modal-acts">
      <button class="btn ghost" data-act="close">${esc(T("common.close"))}</button>
      <button class="btn ghost" data-act="fav">${esc(T(on ? "detail.unfav" : "detail.fav"))}</button>
      <button class="btn" data-act="place">${esc(T("common.place"))}</button>
    </div>`,
    (m) => {
      m.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="close"]')) closeModal();
        if (e.target.closest('[data-act="fav"]')) {
          const f = LS.get("zz_favs", []);
          const i = f.indexOf(sid);
          if (i >= 0) f.splice(i, 1);
          else f.push(sid);
          LS.set("zz_favs", f);
          closeModal();
          render();
          toast(T(i >= 0 ? "toast.unfaved" : "toast.faved"));
        }
        if (e.target.closest('[data-act="place"]')) {
          if (!S)
            S = {
              doc: { name: T("work.untitled"), scene: "pinkroom", items: [] },
              docId: null,
              sel: null,
              hist: [],
              future: [],
              k: 1,
            };
          A.page = "studio";
          closeModal();
          render();
          addSticker(sid);
          toast(T("toast.placed"));
        }
      });
    },
  );
}

/* ---------- Global events ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) {
    if (
      A.page === "studio" &&
      !e.target.closest(".stage") &&
      !e.target.closest(".tray") &&
      !e.target.closest(".topbar")
    ) {
      if (S && S.sel) {
        S.sel = null;
        refreshSel();
      }
    }
    return;
  }
  const act = el.dataset.act;
  /* the language switch, on every page: redraws the page where it is */
  if (act === "lang") {
    window.PigletI18n.setLang(window.PigletI18n.lang() === "zh" ? "en" : "zh");
    return;
  }
  /* home */
  if (act === "start") {
    if (document.querySelector(".mask")) closeModal();
    const draft = LS.get("zz_draft", null);
    if (draft && draft.items && draft.items.length) {
      modal(
        `<h3>${esc(T("resume.title"))}</h3>
        <div style="display:flex;justify-content:center;gap:10px;margin:6px 0 4px">
          <div style="width:120px;height:120px;border-radius:16px;overflow:hidden;background:#FFF6EC">${SVGthumb(draft)}</div>
          <div style="align-self:center;color:#A08A80;font-size:13px;max-width:150px">${esc(T("studio.count", draft.items.length) + " · " + sceneName(draft.scene))}</div>
        </div>
        <div class="modal-acts" style="flex-direction:column">
          <button class="btn" data-act="resume">${esc(T("resume.go"))}</button>
          <button class="btn ghost" data-act="newscene">${esc(T("resume.new"))}</button>
        </div>`,
        (m) => {
          m.addEventListener("click", (ev) => {
            if (ev.target.closest('[data-act="resume"]')) {
              closeModal();
              openStudio({ doc: draft, docId: draft.docId });
            }
            if (ev.target.closest('[data-act="newscene"]')) {
              closeModal();
              sceneModal();
            }
          });
        },
      );
    } else sceneModal();
    return;
  }
  if (act === "newscene") {
    closeModal();
    sceneModal();
    return;
  }
  if (act === "resume") {
    return;
  }
  if (act === "works") {
    A.page = "works";
    render();
    return;
  }
  if (act === "catalog") {
    A.page = "catalog";
    render();
    return;
  }
  if (act === "levels") {
    A.page = "levels";
    render();
    return;
  }
  if (act === "playlevel") {
    const lv = LEVELS.find((x) => x.id === el.dataset.id);
    if (!lv) return;
    openStudio({
      doc: { name: levelName(lv), scene: lv.scene, items: [], level: lv.id },
      docId: null,
    });
    toast(T("toast.levelStart", LEVELS.indexOf(lv) + 1, levelTip(lv)));
    return;
  }
  if (act === "goals") {
    goalsModal();
    return;
  }
  if (act === "theme") {
    const d = daily();
    const sc = SCENES.find((x) => x.id === d.scene) || SCENES[0];
    openStudio({ doc: { name: T("work.today"), scene: sc.id, items: [] }, docId: null });
    toast(todayTheme());
    return;
  }
  if (act === "draft") {
    const d = LS.get("zz_draft", null);
    if (d && d.items && d.items.length) openStudio({ doc: d, docId: d.docId });
    else {
      A.page = "catalog";
      render();
    }
    return;
  }
  if (act === "sound") {
    const on = LS.get("zz_sound", true) !== false;
    LS.set("zz_sound", !on);
    render();
    if (!on) beep(760, 0.08, 0.04);
    return;
  }
  if (act === "home") {
    if (A.page === "studio" && S) saveDraft();
    A.page = "home";
    S = null;
    pts.clear();
    render();
    return;
  }
  if (act === "blindbox") {
    blindbox();
    return;
  }
  if (act === "inspire") {
    if (S) autoCompose();
    return;
  }
  if (act === "close") {
    closeModal();
    return;
  }
  if (act === "cat") {
    A.cat = el.dataset.cat;
    render();
    return;
  }
  if (act === "favfilter") {
    A.favsOnly = !A.favsOnly;
    render();
    return;
  }
  if (act === "detail") {
    detailModal(el.dataset.sid);
    return;
  }
  if (act === "add") {
    addSticker(el.dataset.sid);
    return;
  }

  /* studio (the four works-page actions do not need S, so they pass) */
  if (!S && !["editwork", "copywork", "expwork", "delwork"].includes(act)) return;
  if (act === "undo") {
    undo();
    return;
  }
  if (act === "redo") {
    redo();
    return;
  }
  if (act === "scene") {
    sceneModal();
    return;
  }
  if (act === "save") {
    saveModal();
    return;
  }
  if (act === "export") {
    exportDoc(S.doc, S.doc.name);
    return;
  }
  if (act === "rename") {
    modal(
      `<h3>${esc(T("rename.title"))}</h3>
      <input class="field" id="rn" maxlength="24" value="${esc(S.doc.name)}">
      <div class="modal-acts"><button class="btn ghost" data-act="close">${esc(T("common.cancel"))}</button><button class="btn" id="rnok">${esc(T("common.confirm"))}</button></div>`,
      (m) => {
        const inp = m.querySelector("#rn");
        setTimeout(() => {
          inp.focus();
          inp.select();
        }, 60);
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") inp.blur();
        });
        m.querySelector("#rnok").addEventListener("click", () => {
          S.doc.name = inp.value.trim() || S.doc.name;
          closeModal();
          render();
          flagGoal("rename");
        });
      },
    );
    return;
  }
  if (
    [
      "bigger",
      "smaller",
      "rotate",
      "flip",
      "layerup",
      "layerdown",
      "lock",
      "face",
      "del",
      "dupe",
    ].includes(act)
  ) {
    selAct(act);
    return;
  }

  /* my works */
  if (act === "editwork") {
    const w = LS.get("zz_works", []).find((x) => x.id === el.dataset.id);
    if (w) openStudio({ doc: w, docId: w.id });
    return;
  }
  if (act === "copywork") {
    const works = LS.get("zz_works", []);
    const w = works.find((x) => x.id === el.dataset.id);
    if (w) {
      const cp = Object.assign({}, w, {
        id: "w" + Date.now(),
        name: w.name + T("work.copySuffix"),
        ts: Date.now(),
      });
      works.unshift(cp);
      LS.set("zz_works", works);
      render();
      toast(T("toast.copied"));
    }
    return;
  }
  if (act === "delwork") {
    const id = el.dataset.id;
    modal(
      `<h3>${esc(T("del.title"))}</h3><p style="text-align:center;color:#A08A80;font-size:13px;margin:-6px 0 0">${esc(T("del.body"))}</p>
      <div class="modal-acts"><button class="btn ghost" data-act="close">${esc(T("common.later"))}</button><button class="btn" id="delyes">${esc(T("works.delete"))}</button></div>`,
      (m) => {
        m.querySelector("#delyes").addEventListener("click", () => {
          const works = LS.get("zz_works", []).filter((x) => x.id !== id);
          LS.set("zz_works", works);
          closeModal();
          render();
          toast(T("toast.deleted"));
        });
      },
    );
    return;
  }
  if (act === "expwork") {
    const w = LS.get("zz_works", []).find((x) => x.id === el.dataset.id);
    if (w) exportDoc(w, w.name);
    return;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    A.query = e.target.value;
    const v = e.target.value;
    render();
    const q = document.getElementById("q");
    if (q) {
      q.focus();
      q.setSelectionRange(v.length, v.length);
    }
  }
});
window.addEventListener("resize", () => {
  if (A.page === "studio" && S) {
    fitStage();
  }
});
window.addEventListener("keydown", (e) => {
  if (A.page !== "studio" || !S) return;
  if (e.target.tagName === "INPUT") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (S.sel) {
      e.preventDefault();
      delItem(S.sel);
    }
  }
  if (e.key === "Escape") {
    S.sel = null;
    refreshSel();
  }
});

function SVGthumb(d) {
  const sc = SCENES.find((s) => s.id === d.scene) || SCENES[0];
  return sc.svg;
}

/* Start, and redraw in place when the language changes (an open dialog closes) */
document.title = T("doc.title");
window.PigletI18n.onChange(() => {
  document.title = T("doc.title");
  closeModal();
  render();
});
render();

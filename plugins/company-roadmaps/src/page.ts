/**
 * The roadmaps page: every roadmap of an organization, and the dialog that opens one. The web
 * app mounts it in an iframe at `/org/:projectId/:orgId/roadmaps` (reached from the sidebar's
 * ROADMAPS section: its "All roadmaps" and its "+") and, in its detail view, beside a roadmap's
 * room on the channel page; the page itself is served here, whole, from the plugin — one HTML
 * document with its style and script inline, over the routes the plugin already has.
 *
 * The iframe's `src` is fixed (a contribution is data: it cannot carry the organization), so
 * the page reads the organization off its parent's URL — same origin, so it may — and asks
 * `GET /api/projects/<p>/organizations/<o>/roadmaps[/<n>]` with the cookie it already has. It
 * follows the app's language (`penguin.lang`) and shows the roadmaps (number, name, status,
 * room, moderator, items and their owners) and one roadmap's record and body.
 *
 * It looks like the app because it is dressed in the app's own values rather than a palette of
 * its own: it links the app's base stylesheet for framed pages (`/workflow-ui.css`), copies the
 * app's resolved theme values from its parent's root (dark or light, the gray scale, the accent,
 * the font, the root font size — the list workflow pages get), copies them again whenever the
 * parent's root changes, and lays itself out the way the app's company-mode pages are: a header
 * with its one primary action, rows in a bordered list with a status pill, an empty state in the
 * middle, and a dialog for opening a roadmap.
 *
 * A person opens a roadmap here: the "Open a roadmap" button above the list unfolds a form —
 * a name and one or more of the organization's employees (read from its chart; the first one
 * picked moderates) — which sends the plugin's own `POST …/roadmaps`; the roadmap opens its own
 * room, and the page goes straight to that room. The sidebar's "+" opens this page with
 * `?open=1`, and the dialog is up on arrival. Picking an employee changes the form where it stands:
 * the dialog is drawn once, and nothing in it is drawn again while it is used.
 *
 * A roadmap's room is the app's own channel page. Opening a roadmap goes there (the page's
 * rows, its "Enter the room" and the dialog's Open alike), and that page shows this one beside
 * the stream in its detail view (`?view=detail&n=<n>`, the organization read off the channel
 * page's URL): the record, the body and the items, read again every few seconds. On its own,
 * `roadmaps/<n>` shows the detail only for a roadmap still waiting for its room.
 *
 * Once a roadmap is established, each proposal item is a brief until a person and the moderator
 * both approve it: the detail shows who approved and when, or that it is waiting, and gives the
 * person an Approve button (`POST …/items/<key>/approve`); the moderator approves from its room
 * session. Nothing on this page creates a proposal.
 *
 * An organization that runs on another machine is asked THERE, as the app asks it: the page
 * reads the Project's organization list once, and when the organization names a machine every
 * request goes through `/server/<machine>/…`. Asked here instead, the room would be opened in
 * this server's mirror of the organization, which the next copy from the machine removes.
 *
 * The page is never a blank block. In the dark theme an empty `<main>` is a solid near-black
 * pane, which is what a person saw while the list was on its way and, for good, when the answer
 * never came. So the document is served with a title and a "reading" line already in `<main>`
 * (they stand even if the script never runs), every request first says what it asks, an answer
 * that has not come after {@link PAGE_TIMEOUT_MS} says so, a refusal says its HTTP status and
 * the server's own message, and a script that throws says that.
 */
import { Hono } from "hono";

/** The page's route group: a prefix without parameters, since the iframe's src cannot name them. */
export const PAGE_ROUTES_ID = "company-roadmaps.page-routes";
export const PAGE_PREFIX = "/api/company-roadmaps";
/** Where the iframe points. */
export const PAGE_SRC = `${PAGE_PREFIX}/page`;
/** How long the page waits for an answer before it says the server did not answer. */
export const PAGE_TIMEOUT_MS = 15_000;

/**
 * The app's resolved theme values the page copies from its parent: the same list
 * packages/web's lib/workflow-theme.ts copies into a workflow's frame (a plugin cannot import the
 * web app, so the list is repeated here). Read RESOLVED, so light/dark, the accent and the font
 * size the person chose are already applied; the page recomputes none of it.
 */
export const THEME_VARS = [
  "--font-app-sans",
  "--accent-bg",
  "--accent-fg",
  "--color-gray-50",
  "--color-gray-100",
  "--color-gray-200",
  "--color-gray-300",
  "--color-gray-400",
  "--color-gray-500",
  "--color-gray-600",
  "--color-gray-700",
  "--color-gray-800",
  "--color-gray-900",
  "--color-gray-950",
] as const;

/** The app's base stylesheet for a page in a frame (packages/web/public), linked first so the rules below win. */
export const THEME_HREF = "/workflow-ui.css";

// Every colour is the app's: the `--wf-*` tokens workflow-ui.css derives from the copied values,
// and, for the status pills and strips, the same Tailwind shades tone.ts spells (success = emerald,
// attention = amber, danger = red, muted = gray). Sizes follow the app's rungs in rem, so the
// person's font-size setting (copied onto the root) moves the whole page.
const STYLE = `
:root {
  --rm-bg: var(--wf-bg, #ffffff);
  --rm-fg: var(--wf-fg, #111827);
  --rm-muted: var(--wf-muted, #6b7280);
  --rm-line: var(--wf-border, #e5e7eb);
  --rm-hover: var(--wf-hover, #f3f4f6);
  --rm-surface: var(--wf-surface, #f9fafb);
  --rm-accent: var(--wf-accent, #111827);
  --rm-accent-fg: var(--wf-accent-fg, #ffffff);
  --rm-gray-bg: var(--color-gray-100, #f3f4f6); --rm-gray-fg: var(--color-gray-600, #4b5563);
  --rm-ok-bg: #ecfdf5; --rm-ok-fg: #047857; --rm-ok-line: #5ee9b5;
  --rm-warn-bg: #fffbeb; --rm-warn-fg: #b45309; --rm-warn-line: #ffd236;
  --rm-bad-bg: #fef2f2; --rm-bad-fg: #c10007; --rm-bad-line: #ffa2a2;
  --rm-skeleton: var(--color-gray-200, #e5e7eb);
}
:root.dark {
  --rm-gray-bg: var(--color-gray-800, #1f1f1f); --rm-gray-fg: var(--color-gray-300, #d1d5db);
  --rm-ok-bg: #002c22; --rm-ok-fg: #5ee9b5; --rm-ok-line: #006045;
  --rm-warn-bg: #461901; --rm-warn-fg: #ffd236; --rm-warn-line: #bb4d00;
  --rm-bad-bg: #460809; --rm-bad-fg: #ffa2a2; --rm-bad-line: #c10007;
  --rm-skeleton: var(--color-gray-800, #1f1f1f);
}
* { box-sizing: border-box; }
body { margin: 0; padding: 1rem; background: var(--rm-bg); color: var(--rm-fg); font-size: 0.875rem; line-height: 1.5; }
@media (min-width: 768px) { body { padding: 1.5rem; } }
main { max-width: 72rem; margin: 0 auto; }
.head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; margin-bottom: 1.25rem; }
.head h1 { margin: 0; font-size: 1.25rem; font-weight: 600; line-height: 1.3; display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
h2 { margin: 0 0 0.5rem; font-size: 0.875rem; font-weight: 600; }
section { margin-top: 1.25rem; }
p { margin: 0 0 0.5rem; }
a { color: inherit; text-decoration: none; cursor: pointer; }
a:hover, a:focus-visible { text-decoration: underline; }
.muted { color: var(--rm-muted); }
.small { font-size: 0.6875rem; }
.mono, code { font-family: var(--wf-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
code { font-size: 0.75rem; background: none; border: 0; padding: 0; }
button { font: inherit; font-size: 0.75rem; font-weight: 500; line-height: 1.5; padding: 0.25rem 0.625rem; border-radius: 0.375rem; border: 1px solid var(--rm-line); background: var(--rm-bg); color: var(--rm-fg); cursor: pointer; transition: background-color 150ms, opacity 150ms; }
button:hover:not(:disabled) { background: var(--rm-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--rm-accent); border-color: var(--rm-accent); color: var(--rm-accent-fg); }
button.primary:hover:not(:disabled) { background: var(--rm-accent); opacity: 0.9; }
button.icon { padding: 0.25rem 0.5rem; border-color: transparent; background: transparent; color: var(--rm-muted); }
a.button { display: inline-block; font-size: 0.75rem; font-weight: 500; line-height: 1.5; padding: 0.25rem 0.625rem; border-radius: 0.375rem; border: 1px solid var(--rm-accent); background: var(--rm-accent); color: var(--rm-accent-fg); text-decoration: none; }
a.button:hover { opacity: 0.9; text-decoration: none; }
a.room, a.channel { color: var(--rm-fg); text-decoration: underline; text-underline-offset: 2px; }
button:focus-visible, a:focus-visible, .row:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--rm-accent); outline-offset: 1px; }
.pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.125rem 0.5rem; font-size: 0.6875rem; font-weight: 600; white-space: nowrap; }
.pill.ok { background: var(--rm-ok-bg); color: var(--rm-ok-fg); }
.pill.warn { background: var(--rm-warn-bg); color: var(--rm-warn-fg); }
.pill.gray { background: var(--rm-gray-bg); color: var(--rm-gray-fg); }
.strip { border: 1px solid; border-radius: 0.375rem; padding: 0.5rem 0.75rem; font-size: 0.75rem; margin-bottom: 0.75rem; }
.strip.ok { background: var(--rm-ok-bg); color: var(--rm-ok-fg); border-color: var(--rm-ok-line); }
.strip.warn { background: var(--rm-warn-bg); color: var(--rm-warn-fg); border-color: var(--rm-warn-line); }
.strip.bad { background: var(--rm-bad-bg); color: var(--rm-bad-fg); border-color: var(--rm-bad-line); }
.strip p { margin: 0; }
.strip p + p { margin-top: 0.25rem; }
.rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--rm-line); border-radius: 0.375rem; }
.row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.625rem 0.75rem; border-top: 1px solid var(--rm-line); cursor: pointer; transition: background-color 150ms; }
.row:first-child { border-top: 0; }
.row:hover { background: var(--rm-hover); }
.num { width: 2.5rem; flex-shrink: 0; margin-top: 0.125rem; font-size: 0.6875rem; color: var(--rm-muted); font-variant-numeric: tabular-nums; }
.grow { min-width: 0; flex: 1; }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; }
.title { font-weight: 500; }
.meta { margin-top: 0.25rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; font-size: 0.6875rem; color: var(--rm-muted); }
.items { list-style: none; margin: 0.375rem 0 0; padding: 0; font-size: 0.75rem; }
.items li { margin: 0.125rem 0; }
.items .brief { color: var(--rm-muted); }
.items .approvals { margin-top: 0.25rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.375rem; font-size: 0.6875rem; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 3rem 0; text-align: center; }
.empty .title { font-size: 0.875rem; color: var(--rm-fg); }
.empty .hint { font-size: 0.75rem; color: var(--rm-muted); max-width: 32rem; }
.empty button { margin-top: 0.5rem; }
.crumb { font-size: 0.75rem; margin-bottom: 0.75rem; }
.crumb a { color: var(--rm-muted); }
.card { background: var(--rm-surface); border: 1px solid var(--rm-line); border-radius: 0.375rem; padding: 0.625rem 0.75rem; white-space: pre-wrap; font-size: 0.8125rem; }
.skeleton { height: 3.5rem; border-radius: 0.375rem; background: var(--rm-skeleton); margin-bottom: 0.5rem; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.5; } }
.overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 10vh 1rem 1rem; background: rgb(0 0 0 / 0.4); }
.dialog { width: 100%; max-width: 28rem; background: var(--rm-bg); border: 1px solid var(--rm-line); border-radius: 0.5rem; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.25); animation: pop 150ms ease-out; }
@keyframes pop { from { transform: translateY(0.5rem) scale(0.98); opacity: 0; } }
.dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--rm-line); }
.dialog-head h2 { margin: 0; font-size: 0.875rem; }
.dialog-body { padding: 1rem; }
.dialog-foot { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
.field { display: block; margin: 0 0 0.875rem; padding: 0; border: 0; min-width: 0; }
.field > label, .field > legend { display: block; margin-bottom: 0.25rem; padding: 0; font-size: 0.75rem; font-weight: 500; color: var(--rm-fg); }
.field .hint { margin-top: 0.25rem; font-size: 0.6875rem; color: var(--rm-muted); }
input[name="name"], select { width: 100%; font: inherit; font-size: 0.75rem; padding: 0.3125rem 0.625rem; border-radius: 0.375rem; border: 1px solid var(--rm-line); background: var(--rm-bg); color: var(--rm-fg); }
.picks { list-style: none; margin: 0; padding: 0; border: 1px solid var(--rm-line); border-radius: 0.375rem; max-height: 14rem; overflow-y: auto; }
.picks li { border-top: 1px solid var(--rm-line); }
.picks li:first-child { border-top: 0; }
.picks label { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.625rem; font-size: 0.75rem; cursor: pointer; }
.picks label:hover { background: var(--rm-hover); }
.picks input { accent-color: var(--rm-accent); margin: 0; }
/* In the channel page's column (view=detail): tighter, and as wide as the column. */
body.panel { padding: 0.75rem 1rem; }
body.panel main { max-width: none; }
body.panel .head h1 { font-size: 1rem; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

/** The page's own words, in both languages; the script picks one. */
export const PAGE_STRINGS = {
  en: {
    title: "Roadmaps",
    loading: "Reading this organization's roadmaps…",
    empty: "No roadmap yet in this organization.",
    emptyHint:
      "A roadmap opens its own room — a channel only the roadmap leads to — with the employees you pick.",
    retry: "Retry",
    close: "Close",
    itemsOne: "1 item",
    itemsCount: "{n} items",
    moderator: "moderator",
    enterRoom: "Enter the room",
    unavailable: "Company mode is off here, or this organization does not exist.",
    failed: "Could not read the roadmaps",
    signedOut: "Not signed in, or the sign-in has expired: sign in again and reload.",
    timeout: "The server did not answer within {s} seconds.",
    network: "The request failed before any answer:",
    elsewhere:
      "This page shows an organization's roadmaps at /org/<project>/<org>/roadmaps; it was opened at:",
    broken: "The page could not start:",
    open: "Open a roadmap",
    formEmployees: "Employees — the first one picked moderates",
    formRoomNote:
      "The roadmap opens its own room with the employees you pick: a channel that is not on the channel list, reached from this page.",
    moderates: "moderates",
    noMembers: "This organization has no employee yet.",
    incomplete: "Give it a name and pick at least one employee.",
    submit: "Open",
    cancel: "Cancel",
    opening: "Opening…",
    openFailed: "Could not open the roadmap",
    opened: "Roadmap #{n} opened.",
    number: "#",
    name: "Name",
    status: "Status",
    room: "Room",
    items: "Items",
    back: "← All roadmaps",
    record: "Record",
    body: "Body",
    none: "(empty)",
    owner: "owner",
    employees: "employees",
    archived: "archived",
    awaiting_room: "waiting for its room",
    discussing: "discussing",
    established: "established",
    proposal: "proposal",
    brief: "brief",
    approvals: "approvals",
    byPerson: "a person",
    byModerator: "the moderator",
    waiting: "waiting",
    approve: "Approve",
    approveFailed: "Could not approve",
    approveHint:
      "A proposal item is only a brief until a person and the moderator both approve it; nothing is created before that.",
    noRoom: "This roadmap has no room yet.",
    onMachine:
      "This organization runs on machine {m}; its roadmaps are asked there, so the plugin has to be installed on that machine too.",
  },
  zh: {
    title: "路线图",
    loading: "正在读取本组织的路线图……",
    empty: "本组织还没有路线图。",
    emptyHint: "路线图会自己开一间讨论室——一个只有从路线图才进得去的频道——里面是你选的员工。",
    retry: "重试",
    close: "关闭",
    itemsOne: "1 个条目",
    itemsCount: "{n} 个条目",
    moderator: "主持",
    enterRoom: "进入讨论室",
    unavailable: "这里未开启公司模式，或该组织不存在。",
    failed: "读取路线图失败",
    signedOut: "未登录或登录已过期：请重新登录后刷新。",
    timeout: "服务器 {s} 秒内没有应答。",
    network: "请求在拿到应答之前就失败了：",
    elsewhere: "本页展示 /org/<project>/<org>/roadmaps 下一个组织的路线图；它现在打开在：",
    broken: "页面启动失败：",
    open: "开一份路线图",
    formEmployees: "员工——先选的那位主持",
    formRoomNote:
      "路线图会带着你选的员工自己开一间讨论室：它是一个不在频道列表里的频道，从这一页进去。",
    moderates: "主持",
    noMembers: "这个组织还没有员工。",
    incomplete: "请填上名称，并至少选一名员工。",
    submit: "开",
    cancel: "取消",
    opening: "正在开……",
    openFailed: "没能开出路线图",
    opened: "已开出路线图 #{n}。",
    number: "#",
    name: "名称",
    status: "状态",
    room: "讨论室",
    items: "条目",
    back: "← 全部路线图",
    record: "记录",
    body: "正文",
    none: "（空）",
    owner: "负责人",
    employees: "相关员工",
    archived: "已归档",
    awaiting_room: "等待讨论室",
    discussing: "讨论中",
    established: "已确立",
    proposal: "提案",
    brief: "仅 brief",
    approvals: "批准",
    byPerson: "人",
    byModerator: "主持人",
    waiting: "待批准",
    approve: "批准",
    approveFailed: "批准失败",
    approveHint: "提案条目在人和主持人都批准之前只是一段 brief，在此之前不会建任何东西。",
    noRoom: "这份路线图还没有讨论室。",
    onMachine: "这个组织运行在机器 {m} 上；它的路线图要去那里问，所以那台机器上也得装这个插件。",
  },
} as const;

const SCRIPT = `
const STRINGS = ${JSON.stringify(PAGE_STRINGS)};
const TIMEOUT_MS = ${PAGE_TIMEOUT_MS};
const THEME_VARS = ${JSON.stringify(THEME_VARS)};
const main = document.getElementById("main");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let T = STRINGS.en;
// The page header — the title, and the action beside it when there is one — then the view.
const head = (action) => '<header class="head"><h1>' + esc(T.title) + "</h1>" + (action || "") + "</header>";
const say = (html, action) => { main.innerHTML = head(action) + html; };
try {
  const read = (f, fallback) => { try { return f(); } catch { return fallback; } };
  const lang = String(read(() => localStorage.getItem("penguin.lang"), null) || navigator.language || "en").startsWith("zh") ? "zh" : "en";
  T = STRINGS[lang];
  document.documentElement.lang = lang;
  document.title = T.title;
  // The app's appearance, carried in: its dark/light choice, its resolved gray scale, accent
  // and font, and the root font size the person picked — copied from the parent's root, and
  // copied again whenever the parent's root changes (a theme switch, a new accent, a font size).
  const root = document.documentElement;
  function syncTheme() {
    const dark = read(() => window.parent.document.documentElement.classList.contains("dark"), false);
    if (typeof root.classList.toggle === "function") { root.classList.toggle("dark", dark); root.classList.toggle("light", !dark); }
    else if (dark) root.classList.add("dark");
    const parent = read(() => window.parent.document.documentElement, null);
    const computed = parent && parent !== root ? read(() => window.parent.getComputedStyle(parent), null) : null;
    if (computed && root.style) {
      for (const name of THEME_VARS) {
        const value = String(computed.getPropertyValue(name) || "").trim();
        if (value !== "") root.style.setProperty(name, value);
      }
      const size = read(() => parent.style.fontSize, "") || computed.fontSize;
      if (size) root.style.fontSize = size;
    }
  }
  syncTheme();
  read(() => {
    if (typeof MutationObserver !== "function" || window.parent === window) return;
    new MutationObserver(syncTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  }, null);
  const where = read(() => window.parent.location.pathname, location.pathname);
  // The organization, off the parent's URL: the roadmaps page (/org/<p>/<o>/roadmaps[/<n>]), or,
  // in the channel page's column (view=detail&n=<n>), a channel page (/org/<p>/<o>/channels/<id>).
  const m = /\\/org\\/([^/]+)\\/([^/]+)\\/(?:roadmaps(?:\\/(\\d+))?|channels\\/)/.exec(where);
  // One parameter of a query string (the page's own, or its parent's), or null.
  const param = (search, key) => {
    for (const pair of String(search || "").replace(/^[?]/, "").split("&")) {
      const at = pair.indexOf("=");
      if ((at < 0 ? pair : pair.slice(0, at)) === key) return at < 0 ? "" : read(() => decodeURIComponent(pair.slice(at + 1)), "");
    }
    return null;
  };
  const panelN = param(location.search, "view") === "detail" ? param(location.search, "n") : null;
  const panel = panelN !== null && /^[0-9]+$/.test(panelN);
  if (panel) read(() => { document.body.className = "panel"; }, null);
  // Which list row has a room, by roadmap number (read with the list).
  const rooms = {};
  // One request; an answer that has not come by TIMEOUT_MS is a failure of its own.
  async function request(method, url, body) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject({ method, url, timeout: true }), TIMEOUT_MS); });
    const ask = (async () => {
      let res;
      const init = { method, credentials: "same-origin" };
      if (body !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(body); }
      try { res = await fetch(url, init); } catch (e) { throw { method, url, network: String((e && e.message) || e) }; }
      if (!res.ok) {
        let message = "";
        try { const b = await res.json(); message = (b && b.error && b.error.message) || ""; } catch {}
        throw { method, url, status: res.status, message };
      }
      return res.json();
    })();
    try { return await Promise.race([ask, late]); } finally { clearTimeout(timer); }
  }
  // The organization's API root: this server's, or — for an organization that runs on another
  // machine — that machine's through this server's /server/<machine>/ (see resolveOrg).
  let org = m === null ? "" : "/api/projects/" + m[1] + "/organizations/" + m[2];
  let machine = null;
  async function resolveOrg() {
    const url = "/api/projects/" + m[1] + "/organizations";
    say('<p class="muted">' + esc(T.loading) + '</p><p class="muted small"><code>GET ' + esc(url) + "</code></p>");
    try {
      const listing = await request("GET", url);
      const mine = (listing.organizations || []).find((o) => o.orgId === decodeURIComponent(m[2]));
      if (mine && typeof mine.machineId === "string" && mine.machineId !== "") {
        machine = mine.machineId;
        org = "/server/" + encodeURIComponent(machine) + org;
      }
    } catch {
      // No listing: the organization is asked here, which is where it runs unless it says otherwise.
    }
  }
  const openButton = '<button type="button" class="primary" data-open>' + esc(T.open) + "</button>";
  // A roadmap's room is a channel of the app that the channel list leaves out, and the app's
  // own channel page is where it is read and spoken in: that page shows this page's detail view
  // (view=detail) in a column beside the stream. Going there is a history entry the app's router
  // reads, or, where that cannot be done, an ordinary link of the whole window.
  const roomPath = (channelId) => "/org/" + m[1] + "/" + m[2] + "/channels/" + encodeURIComponent(channelId);
  const listPath = () => "/org/" + m[1] + "/" + m[2] + "/roadmaps";
  const roomLink = (r, cls) => r.channelId ? '<a class="' + cls + '" href="' + esc(roomPath(r.channelId)) + '" target="_top" data-room="' + esc(r.channelId) + '">' + esc(T.enterRoom) + "</a>" : "";
  const enter = (path) => read(() => {
    const parent = window.parent;
    if (!parent || parent === window || !parent.history) return false;
    parent.history.pushState(null, "", path);
    parent.dispatchEvent(new parent.PopStateEvent("popstate"));
    return true;
  }, false);
  const go = (path) => { if (!enter(path)) read(() => { window.top.location.href = path; }, null); };
  // A status as a pill, in the app's tones: under discussion is live work, waiting for a room is
  // unfinished, established is done well, a shelved discussion recedes.
  const pill = (r) => {
    const shelved = r.archived && r.status !== "established";
    const tone = shelved ? "gray" : r.status === "awaiting_room" ? "warn" : r.status === "established" ? "ok" : "ok";
    return '<span class="pill ' + tone + '">' + esc(T[r.status] || r.status) + (shelved ? " · " + esc(T.archived) : "") + "</span>";
  };
  const moderatorOf = (r) => r.moderator || (r.employees && r.employees[0]) || "";
  // A proposal item that is still a brief shows its two approvals — a person's and the
  // moderator's, who and when, or "waiting" — and, where it may ("approvable"), the person's button.
  const approvalLine = (i, d, approvable) => {
    if (i.kind !== "proposal" || !d || d.stage !== "brief") return "";
    const a = d.approvals || {};
    const one = (label, x) => esc(label) + " " + (x ? esc(String(x.by).replace(/^(user|agent):/, "")) + ' <span class="muted small">' + esc(x.at) + "</span>" : '<span class="muted">' + esc(T.waiting) + "</span>");
    return '<div class="approvals"><span class="pill warn">' + esc(T.brief) + "</span> " + esc(T.approvals) + ": " + one(T.byPerson, a.person) + " · " + one(T.byModerator, a.moderator) +
      (approvable && !a.person ? ' <button type="button" data-approve="' + esc(i.key) + '">' + esc(T.approve) + "</button>" : "") + "</div>";
  };
  const itemLine = (i, d, approvable) => "<li><span>" + esc(i.title) + '</span> <span class="muted">— ' + (i.kind === "proposal" ? esc(T.owner) + " " + esc(i.owner) : esc(T.employees) + " " + esc(i.employees.join(", "))) + "</span>" + (d && d.proposal ? ' <span class="pill gray">' + esc(T.proposal) + " #" + d.proposal + "</span>" : "") + '<div class="brief">' + esc(i.brief) + "</div>" + approvalLine(i, d, approvable) + "</li>";
  // A read of the roadmaps, first said out loud (with the rows it is about to fill sketched in).
  async function get(path) {
    const url = org + "/roadmaps" + path;
    say('<p class="muted">' + esc(T.loading) + '</p><p class="muted small"><code>GET ' + esc(url) + '</code></p><div class="skeleton"></div><div class="skeleton"></div>');
    return request("GET", url);
  }
  // Why a request failed, in words: the deadline, the HTTP status with the server's message (or
  // what a bare 404 / 401 means here), the network error, or the script's own throw.
  const failure = (e, heading) => {
    let why;
    if (e && e.timeout) why = esc(T.timeout.replace("{s}", String(TIMEOUT_MS / 1000)));
    else if (e && e.status) {
      const bare = e.status === 404 ? (machine ? T.onMachine.replace("{m}", machine) : T.unavailable) : e.status === 401 ? T.signedOut : "";
      const hint = e.message || bare;
      why = "HTTP " + e.status + (hint ? " — " + esc(hint) : "");
    } else if (e && e.network) why = esc(T.network) + " " + esc(e.network);
    else why = esc(T.broken) + " " + esc((e && e.message) || e);
    return '<div class="strip bad"><p><strong>' + esc(heading || T.failed) + "</strong>: " + why + "</p>" + (e && e.url ? '<p><code>' + esc(e.method || "GET") + " " + esc(e.url) + "</code></p>" : "") + "</div>";
  };
  // What the page shows under a dialog: the view drawn last, kept so closing the dialog
  // returns to it without asking the server again.
  let view = "";
  const draw = (html, action) => { say(html, action); view = main.innerHTML; };
  // The dialog's state while it is open: the organization's employees, and the ones picked, in
  // the order picked (the first moderates). The room is not chosen: the roadmap opens its own.
  let form = null;
  const ready = () => form !== null && form.name.trim() !== "" && form.picked.length > 0;
  const q = (sel) => (typeof main.querySelector === "function" ? main.querySelector(sel) : null);
  // The dialog is drawn once, when it opens; after that only its body is replaced (when the
  // employees arrive), and a pick, a keystroke or a note changes the one element it concerns —
  // so the list of employees keeps its scroll, the name keeps its cursor, nothing jumps.
  function drawForm(note, focus) {
    const f = form;
    let body;
    if (f.members === null) body = '<p class="muted">' + esc(T.loading) + "</p>";
    else if (f.members.length === 0) body = (note || "") + '<p class="muted">' + esc(T.noMembers) + '</p><div class="dialog-foot"><button type="button" data-cancel>' + esc(T.cancel) + "</button></div>";
    else {
      body = '<form data-form><div class="field"><label for="rm-name">' + esc(T.name) + '</label><input id="rm-name" name="name" maxlength="120" autocomplete="off" value="' + esc(f.name) + '"></div>';
      body += '<fieldset class="field"><legend>' + esc(T.formEmployees) + '</legend><ul class="picks">' + f.members.map((e) => '<li><label><input type="checkbox" name="employee" value="' + esc(e.id) + '"' + (f.picked.includes(e.id) ? " checked" : "") + "> <span>" + esc(e.name) + '</span> <span class="muted mono small">' + esc(e.id) + "</span>" + (f.picked[0] === e.id ? moderates : "") + "</label></li>").join("") + '</ul><div class="hint">' + esc(T.formRoomNote) + "</div></fieldset>";
      body += '<div data-note>' + (note || "") + '</div><div class="dialog-foot"><button type="button" data-cancel>' + esc(T.cancel) + '</button><button type="submit" class="primary" data-submit' + (ready() ? "" : " disabled") + ">" + esc(T.submit) + "</button></div></form>";
    }
    const slot = q("[data-overlay] .dialog-body");
    if (slot) slot.innerHTML = body;
    else main.innerHTML = view + '<div class="overlay" data-overlay><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="rm-dialog-title"><div class="dialog-head"><h2 id="rm-dialog-title">' + esc(T.open) + '</h2><button type="button" class="icon" data-cancel aria-label="' + esc(T.close) + '">✕</button></div><div class="dialog-body">' + body + "</div></div></div>";
    if (focus) read(() => q(focus).focus(), null);
  }
  const moderates = ' <span class="pill gray" data-moderates>' + esc(T.moderates) + "</span>";
  // A note under the fields (opening…, why it was refused), without touching the fields.
  const formNote = (html) => { const n = q("[data-note]"); if (n) n.innerHTML = html; else drawForm(html); };
  const closeForm = () => { form = null; main.innerHTML = view; };
  // The submit button follows the fields without redrawing them, so typing keeps its focus.
  const syncSubmit = () => {
    const b = q("[data-submit]");
    if (b) b.disabled = !ready();
  };
  // The moderator's pill moves to whoever is picked first; nothing else in the list changes.
  const syncModerator = () => {
    const was = q("[data-moderates]");
    if (was) was.remove();
    const first = form.picked[0];
    if (first === undefined) return;
    for (const box of main.querySelectorAll('input[name="employee"]')) {
      if (box.value === first) box.closest("label").insertAdjacentHTML("beforeend", moderates);
    }
  };
  async function openForm() {
    form = { members: null, picked: [], name: "" };
    drawForm("");
    try {
      const chart = await request("GET", org + "/chart");
      if (form === null) return;
      form.members = (chart.employees || []).map((e) => ({ id: e.agentId, name: e.name || e.agentId }));
      drawForm("", '[name="name"]');
    } catch (e) { if (form !== null) { form.members = []; drawForm(failure(e, T.openFailed)); } }
  }
  // The roadmap is opened, and the page goes straight to it: its room (the app's channel page)
  // with the roadmap beside it. When the server had something to say (a room session that
  // could not open), the page stays on the roadmap and says it first.
  async function submit() {
    const name = form.name.trim();
    if (!ready()) { formNote('<div class="strip warn"><p>' + esc(T.incomplete) + "</p></div>"); return; }
    formNote('<p class="muted">' + esc(T.opening) + "</p>");
    const b = q("[data-submit]");
    if (b) b.disabled = true;
    try {
      const made = await request("POST", org + "/roadmaps", { name, employees: form.picked });
      form = null;
      const hints = (made.hints || []).map((h) => "<p>" + esc(h) + "</p>").join("");
      const n = String(made.roadmap.number);
      // Straight into it: its room, on the app's channel page, with the roadmap beside it.
      if (made.roadmap.channelId && !hints) { go(roomPath(made.roadmap.channelId)); return; }
      current = n;
      location.hash = n;
      await one(n, '<div class="strip ok"><p>' + esc(T.opened.replace("{n}", n)) + "</p></div>" + (hints ? '<div class="strip warn">' + hints + "</div>" : ""));
    } catch (e) { if (form !== null) { formNote(failure(e, T.openFailed)); syncSubmit(); } }
  }
  async function list(note) {
    const { roadmaps } = await get("");
    for (const r of roadmaps) rooms[r.number] = r.channelId || "";
    if (roadmaps.length === 0) {
      draw((note || "") + '<div class="empty"><p class="title">' + esc(T.empty) + '</p><p class="hint">' + esc(T.emptyHint) + "</p>" + openButton + "</div>");
      return;
    }
    draw((note || "") + '<ul class="rows">' + roadmaps.map((r) => {
      const mod = moderatorOf(r);
      const meta = [
        roomLink(r, "room"),
        mod ? "<span>" + esc(T.moderator) + " " + esc(mod) + "</span>" : "",
        "<span>" + esc(r.items.length === 1 ? T.itemsOne : T.itemsCount.replace("{n}", String(r.items.length))) + "</span>",
      ].filter(Boolean).join('<span aria-hidden="true">·</span>');
      return '<li class="row" data-n="' + r.number + '" tabindex="0"><span class="num mono">#' + r.number + '</span><div class="grow"><div class="line"><a class="title" href="#' + r.number + '" data-n="' + r.number + '">' + esc(r.name) + "</a>" + pill(r) + '</div><div class="meta">' + meta + "</div>" +
        (r.items.length === 0 ? "" : '<ul class="items">' + r.items.map((i) => itemLine(i, r.delegations[i.key])).join("") + "</ul>") + "</div></li>";
    }).join("") + "</ul>", openButton);
  }
  // One roadmap: its record, body and items. On its own (roadmaps/<n>) a roadmap that has a
  // room goes to the room, where it is shown beside the stream; the detail stands here only for
  // one still waiting for its room. In the channel page's column (view=detail) it is read again
  // every DETAIL_POLL_MS, redrawn only when it changed, so the draft follows the discussion.
  const DETAIL_POLL_MS = 10000;
  let poll = null;
  let drawn = "";
  const stopPoll = () => { if (poll !== null) clearInterval(poll); poll = null; };
  const detailHtml = (r, note) => {
    const mod = moderatorOf(r);
    const section = (title, text) => "<section><h2>" + esc(title) + '</h2><div class="card">' + (text ? esc(text) : '<span class="muted">' + esc(T.none) + "</span>") + "</div></section>";
    const top = panel
      ? '<nav class="crumb"><a href="' + esc(listPath()) + '" target="_top" data-list>' + esc(T.back) + "</a></nav>"
      : '<nav class="crumb"><a href="#" data-n="">' + esc(T.back) + "</a></nav>";
    return top + '<header class="head"><h1><span class="muted mono">#' + r.number + "</span> " + esc(r.name) + " " + pill(r) + "</h1>" + (panel ? "" : roomLink(r, "button primary")) + "</header>" + (note || "") +
      '<div class="meta">' + [mod ? esc(T.moderator) + " " + esc(mod) : "", r.channelId ? "" : esc(T.noRoom)].filter(Boolean).join('<span aria-hidden="true">·</span>') + "</div>" +
      section(T.record, r.record) + section(T.body, r.body) +
      "<section><h2>" + esc(T.items) + "</h2>" + (r.items.length === 0 ? '<p class="muted">' + esc(T.none) + "</p>" : '<ul class="rows"><li class="row" style="cursor: default"><ul class="items grow">' + r.items.map((i) => itemLine(i, r.delegations[i.key], r.status === "established")).join("") + "</ul></li></ul>" +
        (r.items.some((i) => i.kind === "proposal") ? '<p class="muted small">' + esc(T.approveHint) + "</p>" : "")) + "</section>";
  };
  // The roadmap the detail shows, for the person's approvals.
  let shown = "";
  async function approve(key) {
    const url = org + "/roadmaps/" + shown + "/items/" + encodeURIComponent(key) + "/approve";
    try {
      await request("POST", url, {});
      await one(shown);
    } catch (e) {
      const slot = q("[data-approve-note]");
      if (slot) slot.innerHTML = failure(e, T.approveFailed);
      else main.insertAdjacentHTML("afterbegin", failure(e, T.approveFailed));
    }
  }
  async function one(n, note) {
    stopPoll();
    shown = String(n);
    const r = await get("/" + n);
    if (!panel && !note && r.channelId && enter(roomPath(r.channelId))) return;
    drawn = JSON.stringify(r);
    main.innerHTML = detailHtml(r, note);
    view = main.innerHTML;
    if (panel) {
      poll = setInterval(() => {
        void request("GET", org + "/roadmaps/" + n).then((again) => {
          const json = JSON.stringify(again);
          if (json === drawn) return;
          drawn = json;
          main.innerHTML = detailHtml(again);
          view = main.innerHTML;
        }).catch(() => {});
      }, DETAIL_POLL_MS);
    }
  }
  let current = "";
  async function show(n) {
    current = n;
    stopPoll();
    try { await (n ? one(n) : list()); } catch (e) { draw(failure(e) + '<p><button type="button" data-retry>' + esc(T.retry) + "</button></p>", n ? "" : openButton); }
  }
  // A roadmap on the list opens its room when it has one, its detail here when it does not.
  const openRoadmap = (n) => {
    const channel = rooms[n];
    if (channel) go(roomPath(channel));
    else location.hash = n;
  };
  // Every control is found through #main, whatever was drawn into it last.
  main.addEventListener("click", (e) => {
    if (e.target.closest("[data-overlay]") && !e.target.closest(".dialog")) { closeForm(); return; }
    if (e.target.closest("[data-cancel]")) { closeForm(); return; }
    if (e.target.closest("[data-open]")) { void openForm(); return; }
    if (e.target.closest("[data-retry]")) { void show(current); return; }
    const room = e.target.closest("[data-room]");
    if (room) { if (enter(room.getAttribute("href"))) e.preventDefault(); return; }
    if (e.target.closest("[data-list]")) { if (enter(listPath())) e.preventDefault(); return; }
    const approving = e.target.closest("[data-approve]");
    if (approving) { approving.disabled = true; void approve(approving.getAttribute("data-approve")); return; }
    const a = e.target.closest("[data-n]");
    if (a && !e.target.closest("input, select, button, label")) {
      e.preventDefault();
      if (a.dataset.n === "") location.hash = "";
      else openRoadmap(a.dataset.n);
    }
  });
  main.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && form) { e.preventDefault(); closeForm(); return; }
    if (e.key === "Enter" && e.target.matches && e.target.matches("li.row[data-n]")) { e.preventDefault(); openRoadmap(e.target.dataset.n); }
  });
  main.addEventListener("input", (e) => {
    if (form && e.target.name === "name") { form.name = e.target.value; syncSubmit(); }
  });
  main.addEventListener("change", (e) => {
    if (!form) return;
    if (e.target.name === "employee") {
      const id = e.target.value;
      form.picked = e.target.checked ? form.picked.filter((x) => x !== id).concat(id) : form.picked.filter((x) => x !== id);
      syncModerator();
      syncSubmit();
    }
  });
  main.addEventListener("submit", (e) => {
    e.preventDefault();
    if (form) void submit();
  });
  window.addEventListener("hashchange", () => { const n = location.hash.slice(1); if (n !== current) void show(n); });
  if (m === null) say('<div class="strip bad"><p>' + esc(T.elsewhere) + " <code>" + esc(where) + "</code></p></div>");
  else if (panel) void resolveOrg().then(() => show(panelN));
  else void resolveOrg().then(async () => {
    await show(location.hash.slice(1) || m[3] || "");
    // The sidebar's "+" opens this page with ?open=1: the dialog is up on arrival.
    if (read(() => param(window.parent.location.search, "open") === "1", false)) void openForm();
  });
} catch (e) {
  if (main) say('<div class="strip bad"><p>' + esc(T.broken) + " " + esc((e && e.message) || e) + "</p></div>");
  else document.body.textContent = T.title + " — " + T.broken + " " + ((e && e.message) || e);
}
`;

/** The whole page, one document. */
export function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roadmaps</title>
<link rel="stylesheet" href="${THEME_HREF}">
<style>${STYLE}</style>
</head>
<body>
<main id="main"><header class="head"><h1>${PAGE_STRINGS.en.title}</h1></header><p class="muted">${PAGE_STRINGS.en.loading}</p></main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** The page's route group: `GET /page` answers the document (behind the cookie gate, like every roadmap route). */
export function pageRoutes(): Hono {
  const app = new Hono();
  app.get("/page", (c) => c.html(pageHtml()));
  return app;
}

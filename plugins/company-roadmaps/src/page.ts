/**
 * The roadmaps page: the entry the organization's sidebar shows after the handbook. The web
 * app draws the row and mounts this page in an iframe at `/org/:projectId/:orgId/roadmaps`;
 * the page itself is served here, whole, from the plugin — one HTML document with its style
 * and script inline, read-only over the routes the plugin already has.
 *
 * The iframe's `src` is fixed (a contribution is data: it cannot carry the organization), so
 * the page reads the organization off its parent's URL — same origin, so it may — and asks
 * `GET /api/projects/<p>/organizations/<o>/roadmaps[/<n>]` with the cookie it already has. It
 * follows the app's language (`penguin.lang`) and its dark class, and shows the roadmaps
 * (number, name, status, room, items and their owners) and one roadmap's record and body.
 */
import { Hono } from "hono";

/** The page's route group: a prefix without parameters, since the iframe's src cannot name them. */
export const PAGE_ROUTES_ID = "company-roadmaps.page-routes";
export const PAGE_PREFIX = "/api/company-roadmaps";
/** Where the iframe points. */
export const PAGE_SRC = `${PAGE_PREFIX}/page`;

const STYLE = `
:root { color-scheme: light; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --bg: #ffffff; --chip: #eaeef2; --link: #0969da; }
:root.dark { color-scheme: dark; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --bg: #0d1117; --chip: #21262d; --link: #4493f8; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 24px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
h1 { font-size: 18px; margin: 0 0 12px; }
h2 { font-size: 15px; margin: 20px 0 8px; }
.muted { color: var(--muted); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12px; }
a { color: var(--link); text-decoration: none; cursor: pointer; }
.chip { display: inline-block; padding: 0 8px; border-radius: 10px; background: var(--chip); font-size: 12px; }
.text { white-space: pre-wrap; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
ul { margin: 0; padding-left: 18px; }
`;

/** The page's own words, in both languages; the script picks one. */
export const PAGE_STRINGS = {
  en: {
    title: "Roadmaps",
    empty: "No roadmap yet. A person opens one over a channel (see the plugin's README).",
    unavailable:
      "Roadmaps are not available here: company mode is off, or this organization does not exist.",
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
  },
  zh: {
    title: "路线图",
    empty: "还没有路线图。由人在一个频道上开一份（见插件的 README）。",
    unavailable: "这里无法使用路线图：公司模式未开启，或该组织不存在。",
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
  },
} as const;

const SCRIPT = `
const STRINGS = ${JSON.stringify(PAGE_STRINGS)};
const read = (f, fallback) => { try { return f(); } catch { return fallback; } };
const lang = String(read(() => localStorage.getItem("penguin.lang"), null) || navigator.language || "en").startsWith("zh") ? "zh" : "en";
const T = STRINGS[lang];
document.documentElement.lang = lang;
if (read(() => window.parent.document.documentElement.classList.contains("dark"), false)) document.documentElement.classList.add("dark");
document.title = T.title;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const where = read(() => window.parent.location.pathname, location.pathname);
const m = /\\/org\\/([^/]+)\\/([^/]+)\\/roadmaps(?:\\/(\\d+))?/.exec(where);
const main = document.getElementById("main");
const status = (r) => esc(T[r.status] || r.status) + (r.archived && r.status !== "established" ? " · " + esc(T.archived) : "");
const itemLine = (i, d) => "<li>[" + esc(i.key) + "] " + esc(i.title) + " — " + (i.kind === "proposal" ? esc(T.owner) + " " + esc(i.owner) : esc(T.employees) + " " + esc(i.employees.join(", "))) + (d && d.proposal ? ' <span class="chip">' + esc(T.proposal) + " #" + d.proposal + "</span>" : "") + '<div class="muted">' + esc(i.brief) + "</div></li>";
async function get(path) {
  const res = await fetch("/api/projects/" + m[1] + "/organizations/" + m[2] + "/roadmaps" + path, { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
async function list() {
  const { roadmaps } = await get("");
  if (roadmaps.length === 0) { main.innerHTML = "<h1>" + esc(T.title) + '</h1><p class="muted">' + esc(T.empty) + "</p>"; return; }
  main.innerHTML = "<h1>" + esc(T.title) + "</h1><table><thead><tr><th>" + [T.number, T.name, T.status, T.room, T.items].map(esc).join("</th><th>") + "</th></tr></thead><tbody>" +
    roadmaps.map((r) => '<tr><td><a data-n="' + r.number + '">#' + r.number + '</a></td><td><a data-n="' + r.number + '">' + esc(r.name) + "</a></td><td>" + status(r) + "</td><td>" + esc(r.channelId || "—") + "</td><td>" + (r.items.length === 0 ? '<span class="muted">' + esc(T.none) + "</span>" : "<ul>" + r.items.map((i) => itemLine(i, r.delegations[i.key])).join("") + "</ul>") + "</td></tr>").join("") +
    "</tbody></table>";
}
async function one(n) {
  const r = await get("/" + n);
  main.innerHTML = '<p><a data-n="">' + esc(T.back) + "</a></p><h1>#" + r.number + " " + esc(r.name) + '</h1><p><span class="chip">' + status(r) + "</span> " + esc(T.room) + " " + esc(r.channelId || "—") + "</p>" +
    "<h2>" + esc(T.record) + '</h2><div class="text">' + (r.record ? esc(r.record) : '<span class="muted">' + esc(T.none) + "</span>") + "</div>" +
    "<h2>" + esc(T.body) + '</h2><div class="text">' + (r.body ? esc(r.body) : '<span class="muted">' + esc(T.none) + "</span>") + "</div>" +
    "<h2>" + esc(T.items) + "</h2>" + (r.items.length === 0 ? '<p class="muted">' + esc(T.none) + "</p>" : "<ul>" + r.items.map((i) => itemLine(i, r.delegations[i.key])).join("") + "</ul>");
}
async function show(n) {
  try { await (n ? one(n) : list()); } catch { main.innerHTML = '<p class="muted">' + esc(T.unavailable) + "</p>"; }
}
main.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-n]");
  if (a) { e.preventDefault(); location.hash = a.dataset.n; }
});
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
if (m === null) main.innerHTML = '<p class="muted">' + esc(T.unavailable) + "</p>";
else show(location.hash.slice(1) || m[3] || "");
`;

/** The whole page, one document. */
export function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roadmaps</title>
<style>${STYLE}</style>
</head>
<body>
<main id="main"></main>
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

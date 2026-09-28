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
 *
 * The page is never a blank block. In the dark theme an empty `<main>` is a solid near-black
 * pane, which is what a person saw while the list was on its way and, for good, when the answer
 * never came. So the document is served with a title and a "reading" line already in `<main>`
 * (they stand even if the script never runs), every request first says what it asks, an answer
 * that has not come after {@link PAGE_TIMEOUT_MS} says so, a refusal says its HTTP status and
 * the server's own message, and a script that throws says that. Creating a roadmap stays a
 * person's CLI/API act; the list says how, with this organization's ids filled in.
 */
import { Hono } from "hono";

/** The page's route group: a prefix without parameters, since the iframe's src cannot name them. */
export const PAGE_ROUTES_ID = "company-roadmaps.page-routes";
export const PAGE_PREFIX = "/api/company-roadmaps";
/** Where the iframe points. */
export const PAGE_SRC = `${PAGE_PREFIX}/page`;
/** How long the page waits for an answer before it says the server did not answer. */
export const PAGE_TIMEOUT_MS = 15_000;

const STYLE = `
:root { color-scheme: light; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --bg: #ffffff; --chip: #eaeef2; --link: #0969da; --bad: #cf222e; --code: #f6f8fa; }
:root.dark { color-scheme: dark; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --bg: #0d1117; --chip: #21262d; --link: #4493f8; --bad: #f85149; --code: #161b22; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 24px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
h1 { font-size: 18px; margin: 0 0 12px; }
h2 { font-size: 15px; margin: 20px 0 8px; }
.muted { color: var(--muted); }
.bad { color: var(--bad); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12px; }
a { color: var(--link); text-decoration: none; cursor: pointer; }
.chip { display: inline-block; padding: 0 8px; border-radius: 10px; background: var(--chip); font-size: 12px; }
.text { white-space: pre-wrap; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; background: var(--code); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
ul { margin: 0; padding-left: 18px; }
`;

/** The page's own words, in both languages; the script picks one. */
export const PAGE_STRINGS = {
  en: {
    title: "Roadmaps",
    loading: "Reading this organization's roadmaps…",
    empty: "No roadmap yet in this organization.",
    unavailable: "Company mode is off here, or this organization does not exist.",
    failed: "Could not read the roadmaps",
    signedOut: "Not signed in, or the sign-in has expired: sign in again and reload.",
    timeout: "The server did not answer within {s} seconds.",
    network: "The request failed before any answer:",
    elsewhere:
      "This page shows an organization's roadmaps at /org/<project>/<org>/roadmaps; it was opened at:",
    broken: "The page could not start:",
    howTitle: "Open a roadmap",
    howIntro:
      "This page only reads. A person opens a roadmap from a terminal: a channel is the room, the employees who will discuss are invited into it, and the roadmap is opened over that channel.",
    howNote:
      "Employee ids: penguin org chart. The token: $PENGUIN_API_TOKEN, or the api-token file in the server's data root. The employees are told the rest in the room; the roadmap then shows here.",
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
    loading: "正在读取本组织的路线图……",
    empty: "本组织还没有路线图。",
    unavailable: "这里未开启公司模式，或该组织不存在。",
    failed: "读取路线图失败",
    signedOut: "未登录或登录已过期：请重新登录后刷新。",
    timeout: "服务器 {s} 秒内没有应答。",
    network: "请求在拿到应答之前就失败了：",
    elsewhere: "本页展示 /org/<project>/<org>/roadmaps 下一个组织的路线图；它现在打开在：",
    broken: "页面启动失败：",
    howTitle: "开一份路线图",
    howIntro:
      "本页只读。路线图由人在终端里开：一个频道就是讨论室，把要参与讨论的员工邀请进去，再在这个频道上开路线图。",
    howNote:
      "员工 id：penguin org chart。令牌：$PENGUIN_API_TOKEN，或服务器数据根下的 api-token 文件。其余的事员工会在讨论室里得知；开好后路线图就出现在这里。",
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

/**
 * The three commands that open a roadmap (README, Use), for the organization at hand. `origin`
 * is where the API answers — the page's own origin.
 */
export function roadmapRecipe(projectId: string, orgId: string, origin: string): string {
  const where = `--org-id ${orgId} --project-id ${projectId}`;
  return [
    `penguin org channel create room_queue --name "Queue migration" ${where}`,
    `penguin org channel invite room_queue agent:<employee> agent:<employee> ${where}`,
    `curl -X POST "${origin}/api/projects/${projectId}/organizations/${orgId}/roadmaps" \\`,
    `  -H "authorization: Bearer $PENGUIN_API_TOKEN" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"name": "Queue migration", "channelId": "room_queue", "employees": ["<employee>", "<employee>"]}'`,
  ].join("\n");
}

const SCRIPT = `
const STRINGS = ${JSON.stringify(PAGE_STRINGS)};
const TIMEOUT_MS = ${PAGE_TIMEOUT_MS};
// The recipe with its three ids left as placeholders the page fills in.
const RECIPE = ${JSON.stringify(roadmapRecipe("{project}", "{org}", "{origin}"))};
const main = document.getElementById("main");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let T = STRINGS.en;
const say = (html) => { main.innerHTML = "<h1>" + esc(T.title) + "</h1>" + html; };
try {
  const read = (f, fallback) => { try { return f(); } catch { return fallback; } };
  const lang = String(read(() => localStorage.getItem("penguin.lang"), null) || navigator.language || "en").startsWith("zh") ? "zh" : "en";
  T = STRINGS[lang];
  document.documentElement.lang = lang;
  if (read(() => window.parent.document.documentElement.classList.contains("dark"), false)) document.documentElement.classList.add("dark");
  document.title = T.title;
  const where = read(() => window.parent.location.pathname, location.pathname);
  const origin = read(() => location.origin, "") || "";
  const m = /\\/org\\/([^/]+)\\/([^/]+)\\/roadmaps(?:\\/(\\d+))?/.exec(where);
  const status = (r) => esc(T[r.status] || r.status) + (r.archived && r.status !== "established" ? " · " + esc(T.archived) : "");
  const itemLine = (i, d) => "<li>[" + esc(i.key) + "] " + esc(i.title) + " — " + (i.kind === "proposal" ? esc(T.owner) + " " + esc(i.owner) : esc(T.employees) + " " + esc(i.employees.join(", "))) + (d && d.proposal ? ' <span class="chip">' + esc(T.proposal) + " #" + d.proposal + "</span>" : "") + '<div class="muted">' + esc(i.brief) + "</div></li>";
  const how = () => "<h2>" + esc(T.howTitle) + "</h2><p>" + esc(T.howIntro) + "</p><pre>" + esc(RECIPE.split("{project}").join(m[1]).split("{org}").join(m[2]).split("{origin}").join(origin)) + '</pre><p class="muted">' + esc(T.howNote) + "</p>";
  // One request, first said out loud; an answer that has not come by TIMEOUT_MS is a failure of its own.
  async function get(path) {
    const url = "/api/projects/" + m[1] + "/organizations/" + m[2] + "/roadmaps" + path;
    say('<p class="muted">' + esc(T.loading) + '</p><p class="muted"><code>GET ' + esc(url) + "</code></p>");
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject({ url, timeout: true }), TIMEOUT_MS); });
    const ask = (async () => {
      let res;
      try { res = await fetch(url, { credentials: "same-origin" }); } catch (e) { throw { url, network: String((e && e.message) || e) }; }
      if (!res.ok) {
        let message = "";
        try { const b = await res.json(); message = (b && b.error && b.error.message) || ""; } catch {}
        throw { url, status: res.status, message };
      }
      return res.json();
    })();
    try { return await Promise.race([ask, late]); } finally { clearTimeout(timer); }
  }
  // Why a request failed, in words: the deadline, the HTTP status with the server's message (or
  // what a bare 404 / 401 means here), the network error, or the script's own throw.
  const failure = (e) => {
    let why;
    if (e && e.timeout) why = esc(T.timeout.replace("{s}", String(TIMEOUT_MS / 1000)));
    else if (e && e.status) {
      const hint = e.message || (e.status === 404 ? T.unavailable : e.status === 401 ? T.signedOut : "");
      why = "HTTP " + e.status + (hint ? " — " + esc(hint) : "");
    } else if (e && e.network) why = esc(T.network) + " " + esc(e.network);
    else why = esc(T.broken) + " " + esc((e && e.message) || e);
    return '<p class="bad"><strong>' + esc(T.failed) + "</strong>: " + why + "</p>" + (e && e.url ? '<p class="muted"><code>GET ' + esc(e.url) + "</code></p>" : "");
  };
  async function list() {
    const { roadmaps } = await get("");
    if (roadmaps.length === 0) { say("<p>" + esc(T.empty) + "</p>" + how()); return; }
    say("<table><thead><tr><th>" + [T.number, T.name, T.status, T.room, T.items].map(esc).join("</th><th>") + "</th></tr></thead><tbody>" +
      roadmaps.map((r) => '<tr><td><a data-n="' + r.number + '">#' + r.number + '</a></td><td><a data-n="' + r.number + '">' + esc(r.name) + "</a></td><td>" + status(r) + "</td><td>" + esc(r.channelId || "—") + "</td><td>" + (r.items.length === 0 ? '<span class="muted">' + esc(T.none) + "</span>" : "<ul>" + r.items.map((i) => itemLine(i, r.delegations[i.key])).join("") + "</ul>") + "</td></tr>").join("") +
      "</tbody></table>" + how());
  }
  async function one(n) {
    const r = await get("/" + n);
    main.innerHTML = '<p><a data-n="">' + esc(T.back) + "</a></p><h1>#" + r.number + " " + esc(r.name) + '</h1><p><span class="chip">' + status(r) + "</span> " + esc(T.room) + " " + esc(r.channelId || "—") + "</p>" +
      "<h2>" + esc(T.record) + '</h2><div class="text">' + (r.record ? esc(r.record) : '<span class="muted">' + esc(T.none) + "</span>") + "</div>" +
      "<h2>" + esc(T.body) + '</h2><div class="text">' + (r.body ? esc(r.body) : '<span class="muted">' + esc(T.none) + "</span>") + "</div>" +
      "<h2>" + esc(T.items) + "</h2>" + (r.items.length === 0 ? '<p class="muted">' + esc(T.none) + "</p>" : "<ul>" + r.items.map((i) => itemLine(i, r.delegations[i.key])).join("") + "</ul>");
  }
  async function show(n) {
    try { await (n ? one(n) : list()); } catch (e) { say(failure(e)); }
  }
  main.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-n]");
    if (a) { e.preventDefault(); location.hash = a.dataset.n; }
  });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  if (m === null) say('<p class="bad">' + esc(T.elsewhere) + " <code>" + esc(where) + "</code></p>");
  else show(location.hash.slice(1) || m[3] || "");
} catch (e) {
  if (main) say('<p class="bad">' + esc(T.broken) + " " + esc((e && e.message) || e) + "</p>");
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
<style>${STYLE}</style>
</head>
<body>
<main id="main"><h1>${PAGE_STRINGS.en.title}</h1><p class="muted">${PAGE_STRINGS.en.loading}</p></main>
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

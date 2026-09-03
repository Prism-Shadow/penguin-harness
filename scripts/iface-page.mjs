#!/usr/bin/env node
/**
 * iface-page: render a package's generated ifaces.json (scripts/gen-ifaces.mjs) as ONE
 * self-contained HTML page — the module tree, every node's requires / provides /
 * contributes, and every interface at signature level — beside a copy of the JSON.
 *
 *   node scripts/iface-page.mjs --in packages/server/src/ifaces.json --out dist-ifaces
 *
 * The page's header carries the table's hash; `<out>/ifaces.json` is byte-for-byte the
 * table the page was rendered from, so the URL of a page names one interface state.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const inPath = opt("--in", "packages/server/src/ifaces.json");
const outDir = opt("--out", "dist-ifaces");
const meta = {
  sha: opt("--sha", process.env.GITHUB_SHA ?? ""),
  ref: opt("--ref", process.env.GITHUB_REF_NAME ?? ""),
  repo: opt("--repo", process.env.GITHUB_REPOSITORY ?? ""),
  builtAt: new Date().toISOString(),
};

const text = fs.readFileSync(inPath, "utf8");
const table = JSON.parse(text);
if (typeof table.hash !== "string") {
  console.error(`iface-page: ${inPath} carries no hash — regenerate it with gen-ifaces`);
  process.exit(1);
}

// The whole renderer lives in the page: the data is embedded as JSON, nothing is fetched.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>module tree · ${table.hash.slice(0, 12)}</title>
<style>
:root { color-scheme: light dark; --ink: #1f2328; --muted: #6a737d; --line: #d0d7de; --bg: #fff; --panel: #f6f8fa; --accent: #0969da; --mod: #8250df; --comp: #1a7f37; }
@media (prefers-color-scheme: dark) { :root { --ink: #e6edf3; --muted: #8b949e; --line: #30363d; --bg: #0d1117; --panel: #161b22; --accent: #58a6ff; --mod: #d2a8ff; --comp: #3fb950; } }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: baseline; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
header h1 { font-size: 16px; margin: 0; }
header code, .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hash { color: var(--muted); }
header a { color: var(--accent); text-decoration: none; }
header input { margin-left: auto; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); min-width: 220px; }
main { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; min-height: calc(100vh - 50px); }
nav { border-right: 1px solid var(--line); padding: 12px 8px; overflow: auto; max-height: calc(100vh - 50px); position: sticky; top: 50px; }
nav ul { list-style: none; margin: 0; padding-left: 16px; }
nav > ul { padding-left: 4px; }
nav li { margin: 1px 0; }
nav button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 4px; display: inline-block; }
nav button:hover, nav button.current { background: var(--panel); }
nav button.current { outline: 1px solid var(--line); }
.kind { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin-right: 6px; padding: 0 4px; border-radius: 3px; border: 1px solid; }
.kind.module { color: var(--mod); border-color: var(--mod); }
.kind.component { color: var(--comp); border-color: var(--comp); }
.kind.iface { color: var(--accent); border-color: var(--accent); }
.kind.slot { color: var(--muted); border-color: var(--muted); }
section { padding: 16px 24px; max-width: 1100px; }
section h2 { margin: 0 0 4px; font-size: 20px; }
section h3 { margin: 18px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: 13px; }
th { color: var(--muted); font-weight: 500; }
pre, code.sig { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; margin: 0; }
pre { background: var(--panel); padding: 10px 12px; border-radius: 6px; overflow: auto; }
a.ref { color: var(--accent); text-decoration: none; border-bottom: 1px dotted; }
.opaque { color: var(--muted); font-style: italic; }
.hidden { display: none; }
details { margin: 4px 0; }
summary { cursor: pointer; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>module tree</h1>
  <span class="hash" title="sha256 of the interface table">${table.hash}</span>
  <a href="ifaces.json">ifaces.json</a>
  ${meta.repo ? `<a href="https://github.com/${meta.repo}/commit/${meta.sha}"><code>${meta.sha.slice(0, 7)}</code> ${meta.ref}</a>` : ""}
  <input id="q" type="search" placeholder="filter nodes and interfaces">
</header>
<main>
  <nav id="tree"></nav>
  <section id="detail"><p class="muted">Pick a node or an interface.</p></section>
</main>
<script id="data" type="application/json">${text.replace(/<\//g, "<\\/")}</script>
<script>
const T = JSON.parse(document.getElementById("data").textContent);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const short = (key) => key.slice(key.indexOf("#") + 1);
const ref = (key, kind) => '<a class="ref" href="#' + kind + ':' + encodeURIComponent(key) + '" title="' + esc(key) + '">' + esc(short(key)) + "</a>";
const isComponent = (m) => Object.entries(m.provides).length === 1 && Object.entries(m.provides).every(([alias, key]) => key === m.name + "#" + alias);

// --- TypeExpr → TypeScript-ish text (mirrors core kernel/sig.ts) ---
function data(d) {
  if (typeof d === "string") return esc(d);
  if (Array.isArray(d)) return d.map((x) => (typeof x === "string" && /^(\\|\\s*|\\[\\]|\\?)$/.test(x) ? esc(x) : data(x))).join(" ");
  if (d && typeof d === "object") {
    if ("$ref" in d) return ref(d.$ref, "type");
    const parts = Object.entries(d).map(([k, v]) => esc(k) + ": " + data(v));
    return "{ " + parts.join("; ") + " }";
  }
  return esc(JSON.stringify(d));
}
function expr(e) {
  if (!e || typeof e !== "object") return esc(String(e));
  if ("data" in e) return data(e.data);
  if ("$ref" in e) return ref(e.$ref, "type");
  if ("iface" in e) return ref(e.iface, "iface");
  if ("opaque" in e) return '<span class="opaque">' + esc(e.opaque) + "</span>";
  if ("void" in e) return "void";
  if ("promise" in e) return "Promise&lt;" + expr(e.promise) + "&gt;";
  if ("stream" in e) return "AsyncIterable&lt;" + expr(e.stream) + "&gt;";
  if ("array" in e) return "(" + expr(e.array) + ")[]";
  if ("maybe" in e) return expr(e.maybe) + " | undefined";
  if ("oneOf" in e) return e.oneOf.map(expr).join(" | ");
  if ("fn" in e) return "(" + sigParams(e.fn) + ") =&gt; " + expr(e.fn.returns);
  if ("object" in e) {
    const opt = new Set(e.optional ?? []);
    return "{ " + Object.entries(e.object).map(([k, v]) => esc(k) + (opt.has(k) ? "?" : "") + ": " + expr(v)).join("; ") + " }";
  }
  return esc(JSON.stringify(e));
}
const sigParams = (sig) => sig.params.map((p, i) => "p" + i + ("maybe" in p ? "?" : "") + ": " + expr("maybe" in p ? p.maybe : p)).join(", ");
const method = (name, sig) => esc(name) + "(" + sigParams(sig) + "): " + expr(sig.returns);

// --- tree ---
const modules = T.modules;
const childOf = new Set(Object.values(modules).flatMap((m) => m.children.filter((c) => c !== "*")));
const roots = Object.keys(modules).filter((n) => !childOf.has(n));
function node(name) {
  const m = modules[name];
  if (!m) return "<li><button disabled>" + esc(name) + " (not in this table)</button></li>";
  const kind = isComponent(m) ? "component" : "module";
  const kids = m.children.map((c) => (c === "*" ? '<li><span class="kind slot">slot</span><span class="muted">plugin modules</span></li>' : node(c))).join("");
  return "<li data-name=\\"" + esc(name) + "\\"><button data-go=\\"node:" + encodeURIComponent(name) + "\\"><span class=\\"kind " + kind + "\\">" + kind[0] + "</span>" + esc(name) + "</button>" + (kids ? "<ul>" + kids + "</ul>" : "") + "</li>";
}
const ifaceKeys = Object.keys(T.ifaces).sort();
document.getElementById("tree").innerHTML =
  "<ul>" + roots.map(node).join("") + "</ul>" +
  "<h3 class=\\"muted\\" style=\\"margin:14px 6px 4px;font-size:12px\\">interfaces (" + ifaceKeys.length + ")</h3><ul>" +
  ifaceKeys.map((k) => "<li data-name=\\"" + esc(k) + "\\"><button data-go=\\"iface:" + encodeURIComponent(k) + "\\"><span class=\\"kind iface\\">i</span>" + esc(short(k)) + "</button></li>").join("") + "</ul>";

// --- detail ---
function showNode(name) {
  const m = modules[name];
  const kind = isComponent(m) ? "component" : "module";
  const req = Object.entries(m.requires);
  const prov = Object.entries(m.provides);
  const contrib = Object.entries(m.contributes);
  const providers = Object.entries(modules).filter(([, o]) => Object.values(o.requires).some((r) => r.from === name)).map(([n]) => n);
  return "<h2><span class=\\"kind " + kind + "\\">" + kind + "</span>" + esc(name) + "</h2>" +
    (m.context ? "<p class=\\"muted\\">parks context v" + esc(m.context.version) + "</p>" : "") +
    "<h3>requires (" + req.length + ")</h3>" + (req.length ? "<table><tr><th>field</th><th>interface</th><th>from</th></tr>" +
      req.map(([f, r]) => "<tr><td><code>" + esc(f) + "</code></td><td>" + ref(r.iface, "iface") + "</td><td>" + (r.from ? '<a class="ref" href="#node:' + encodeURIComponent(r.from) + '">' + esc(r.from) + "</a>" : "<span class=\\"muted\\">by structure</span>") + "</td></tr>").join("") + "</table>" : "<p class=\\"muted\\">nothing</p>") +
    "<h3>provides (" + prov.length + ")</h3>" + (prov.length ? "<table><tr><th>alias</th><th>interface</th></tr>" +
      prov.map(([a, k]) => "<tr><td><code>" + esc(a) + "</code></td><td>" + ref(k, "iface") + "</td></tr>").join("") + "</table>" : "<p class=\\"muted\\">nothing</p>") +
    "<h3>contributes (" + contrib.length + ")</h3>" + (contrib.length ? contrib.map(([slot, items]) =>
      "<details open><summary><code>" + esc(slot) + "</code> × " + items.length + "</summary><pre>" + esc(JSON.stringify(items, null, 2)) + "</pre></details>").join("") : "<p class=\\"muted\\">nothing</p>") +
    (m.children.length ? "<h3>children (" + m.children.length + ")</h3><p>" + m.children.map((c) => c === "*" ? "<span class=\\"muted\\">+ plugin modules</span>" : '<a class="ref" href="#node:' + encodeURIComponent(c) + '">' + esc(c) + "</a>").join(", ") + "</p>" : "") +
    (providers.length ? "<h3>wired into</h3><p>" + providers.map((n) => '<a class="ref" href="#node:' + encodeURIComponent(n) + '">' + esc(n) + "</a>").join(", ") + "</p>" : "");
}
function showIface(key) {
  const d = T.ifaces[key];
  if (!d) return "<h2>" + esc(key) + "</h2><p class=\\"muted\\">not in this table</p>";
  const methods = Object.entries(d.methods);
  const fields = Object.entries(d.fields ?? {});
  const slots = Object.entries(d.slots ?? {});
  const providedBy = Object.entries(modules).filter(([, m]) => Object.values(m.provides).includes(key)).map(([n]) => n);
  const requiredBy = Object.entries(modules).filter(([, m]) => Object.values(m.requires).some((r) => r.iface === key)).map(([n]) => n);
  return "<h2><span class=\\"kind iface\\">interface</span>" + esc(d.name) + "</h2><p class=\\"hash\\">" + esc(key) + "</p>" +
    "<pre>" + [...methods.map(([n, s]) => method(n, s)), ...fields.map(([n, e]) => esc(n) + ("maybe" in e ? "?" : "") + ": " + expr("maybe" in e ? e.maybe : e))].join("\\n") + (methods.length + fields.length ? "" : "<span class=\\"muted\\">(no members)</span>") + "</pre>" +
    (slots.length ? "<h3>slots</h3><table><tr><th>slot</th><th>data</th><th>code</th></tr>" + slots.map(([n, s]) => "<tr><td><code>" + esc(n) + "</code></td><td><code class=\\"sig\\">" + expr(s.data ?? s) + "</code></td><td>" + (s.code ? '<code class="sig">' + expr(s.code) + "</code>" : "<span class=\\"muted\\">—</span>") + "</td></tr>").join("") + "</table>" : "") +
    "<h3>provided by</h3><p>" + (providedBy.length ? providedBy.map((n) => '<a class="ref" href="#node:' + encodeURIComponent(n) + '">' + esc(n) + "</a>").join(", ") : "<span class=\\"muted\\">no module — a consumer-declared shape</span>") + "</p>" +
    "<h3>required by</h3><p>" + (requiredBy.length ? requiredBy.map((n) => '<a class="ref" href="#node:' + encodeURIComponent(n) + '">' + esc(n) + "</a>").join(", ") : "<span class=\\"muted\\">nobody</span>") + "</p>";
}
function showType(key) {
  const t = T.types[key];
  return "<h2><span class=\\"kind slot\\">type</span>" + esc(short(key)) + "</h2><p class=\\"hash\\">" + esc(key) + "</p><pre>" + (t === undefined ? "<span class=\\"muted\\">host-declared: compared by name</span>" : data(t)) + "</pre>";
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const i = h.indexOf(":");
  const kind = h.slice(0, i), key = h.slice(i + 1);
  const el = document.getElementById("detail");
  el.innerHTML = kind === "node" && modules[key] ? showNode(key) : kind === "iface" ? showIface(key) : kind === "type" ? showType(key) : el.innerHTML;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("current", b.dataset.go === kind + ":" + encodeURIComponent(key)));
}
document.getElementById("tree").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-go]");
  if (b) location.hash = b.dataset.go;
});
document.getElementById("q").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("nav li[data-name]").forEach((li) => {
    li.classList.toggle("hidden", q !== "" && !li.dataset.name.toLowerCase().includes(q) && !li.querySelector("li[data-name]:not(.hidden)"));
  });
});
window.addEventListener("hashchange", route);
if (!location.hash && roots[0]) location.hash = "node:" + encodeURIComponent(roots[0]);
route();
</script>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), page);
fs.writeFileSync(path.join(outDir, "ifaces.json"), text);
console.log(
  `iface-page: wrote ${outDir}/index.html + ifaces.json (${table.hash.slice(0, 12)}, ${Object.keys(table.modules).length} nodes, ${Object.keys(table.ifaces).length} interfaces)`,
);

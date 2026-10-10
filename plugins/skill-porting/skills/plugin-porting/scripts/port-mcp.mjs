#!/usr/bin/env node
// Turns the MCP servers of a Codex or Claude Code plugin into the `penguin.mcp_servers` of a
// PenguinHarness plugin package.
//
//   node port-mcp.mjs <source dir> [--root <upstream folder url>]
//                     [--oauth <server>]... [--bearer <server>[=KEY]]...
//
// The servers are read from `.codex-plugin/plugin.json`'s `mcpServers` file (default
// `.mcp.json`), from `.claude-plugin/plugin.json`'s `mcpServers` (a file or an inline map), or
// from a root `.mcp.json`; a map with or without the `mcpServers` wrapper. It prints
// `{ "mcp_servers": [...], "notes": [...] }`: paste `mcp_servers` into the package.json's
// `penguin` block and the notes into the README. Values a server needs from the user become
// `${KEY}` references to the Agent's vault, each listed in the server's `setup`; the package
// never carries a value. Rules:
// - the server's name is its key lower-cased, `[^a-z0-9_-]` → `-`, starting with a letter or a
//   digit; a name taken twice gets `-2`, `-3`, …;
// - `type: "http"` / `"sse"` + `url` → that transport (the URL must be http(s), and its host
//   may not take a variable); `command` → stdio; anything else is not carried;
// - a stdio `command` or `./` argument that is a path inside the plugin, and a relative `cwd`,
//   are rooted at `${PLUGIN_ROOT}` (the package directory on the server): the notes name each
//   file that must be carried into the package with the same path; a path leaving the plugin
//   (`../`) is not carried;
// - Codex `env_vars: [NAME]` (host variables forwarded when set) → `env: { NAME: "${NAME}" }`,
//   Codex `bearer_token_env_var` → an `Authorization: Bearer ${NAME}` header;
// - `${CLAUDE_PLUGIN_ROOT}` → `${PLUGIN_ROOT}`; Claude's `${VAR}` stays a reference
//   (`${VAR:-default}` loses its default, named in the notes); an `<ANGLE_PLACEHOLDER>` becomes
//   `${ANGLE_PLACEHOLDER}`, labelled with its words;
// - a literal token in a header (`Bearer <20+ token characters>`) is not carried: it becomes
//   `${<NAME>_TOKEN}`;
// - `oauth`, `scopes` or `oauth_resource` (or `--oauth <server>`, when only the upstream prose
//   says the server signs in with OAuth) → `config.oauth { scopes?, client_id?, client_secret? }`;
//   a literal `client_id` is kept (a public identifier), a literal `client_secret` is not: it
//   becomes `${<NAME>_CLIENT_SECRET}`; `callback_port`, `callback_url` and `oauth_resource` are
//   left behind (another client's sign-in flow);
// - `--bearer <server>[=KEY]`, when the upstream prose names a token as the alternative to
//   OAuth, adds `Authorization: Bearer ${KEY}` (default `<NAME>_TOKEN`);
// - Codex `startup_timeout_sec` / `tool_timeout_sec` → `connectTimeoutMs` / `timeoutMs`;
// - an upstream `note` goes to the notes, for the README.
// `<NAME>` is the server's name upper-cased with `_` between words. Built-in modules only.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const src = args[0];
/** Every value given for a repeatable flag. */
const flagValues = (flag) => {
  const values = [];
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1] !== undefined) values.push(args[(i += 1)]);
  }
  return values;
};
if (src === undefined || src.startsWith("--")) {
  console.error(
    "usage: node port-mcp.mjs <source dir> [--root <upstream folder url>] [--oauth <server>]... [--bearer <server>[=KEY]]...",
  );
  process.exit(2);
}
const upstreamRoot = flagValues("--root")[0]?.replace(/\/+$/, "");
const oauthFor = new Set(flagValues("--oauth"));
const bearerFor = new Map(
  flagValues("--bearer").map((spec) => {
    const at = spec.indexOf("=");
    return at === -1 ? [spec, undefined] : [spec.slice(0, at), spec.slice(at + 1)];
  }),
);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exists = (rel) => fs.existsSync(path.join(src, rel));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(src, rel), "utf8"));

/** The vault's key rule; `PLUGIN_ROOT` is the package directory, never a key. */
const VAULT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Words that keep their capitals in a label. */
const ACRONYMS = new Set(["ID", "URL", "API", "MCP", "OAUTH", "SSO", "SDK", "AI", "HTTP", "PAT"]);

/** `GMAIL_PUBLIC_CLIENT_ID` → `Gmail public client ID`; `cloudflare-api` → `Cloudflare API`. */
function labelOf(words) {
  return words
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word, index) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper === "OAUTH" ? "OAuth" : upper;
      const lower = word.toLowerCase();
      return index === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** A server name as a vault key's stem: upper case, `_` between words. */
const keyStem = (name) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Where the server map lives: the plugin manifest's pointer, else a root `.mcp.json`. */
function findServers() {
  for (const manifest of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
    if (!exists(manifest)) continue;
    const declared = readJson(manifest).mcpServers;
    if (isRecord(declared)) return { map: declared, from: manifest };
    const rel = typeof declared === "string" ? declared : ".mcp.json";
    if (exists(rel)) return { map: readJson(rel), from: rel.replace(/^\.\//, "") };
    if (typeof declared === "string") return { map: {}, from: rel, missing: true };
  }
  if (exists(".mcp.json")) return { map: readJson(".mcp.json"), from: ".mcp.json" };
  return null;
}

const notes = [];
const found = findServers();
if (found === null) {
  console.log(JSON.stringify({ mcp_servers: [], notes: ["the plugin declares no MCP servers"] }));
  process.exit(0);
}
if (found.missing) notes.push(`${found.from} is named by the manifest but is not in the plugin`);
const upstream = isRecord(found.map.mcpServers) ? found.map.mcpServers : found.map;

const servers = [];
const taken = new Set();
for (const [id, spec] of Object.entries(upstream)) {
  if (!isRecord(spec)) {
    notes.push(`${id}: not a server definition; not carried`);
    continue;
  }
  let name = id
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  if (name === "") name = "server";
  if (taken.has(name)) {
    let n = 2;
    while (taken.has(`${name}-${n}`)) n += 1;
    notes.push(`${id}: the name ${name} is already used; carried as ${name}-${n}`);
    name = `${name}-${n}`;
  }
  const setup = [];
  /** Lists a vault key the server needs, once; the first label given wins. */
  const needKey = (key, label) => {
    if (!setup.some((item) => item.key === key)) {
      setup.push({ key, ...(label !== undefined ? { label } : {}) });
    }
  };
  /** A string value with the plugin root, placeholders and variables turned into references. */
  const rewrite = (text, where) =>
    text
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${PLUGIN_ROOT}")
      .replace(/<([A-Za-z][A-Za-z0-9 _-]*)>/g, (_whole, words) => {
        const key = keyStem(words);
        needKey(key, labelOf(words));
        return `\${${key}}`;
      })
      .replace(/\$\{([^}]*)\}/g, (whole, inner) => {
        if (inner === "PLUGIN_ROOT") return whole;
        const variable = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/.exec(inner);
        if (variable === null) {
          notes.push(`${name}: ${where} refers to \${${inner}}, which is not a vault key`);
          return whole;
        }
        needKey(variable[1]);
        if (variable[2] !== undefined) {
          notes.push(
            `${name}: ${where} defaulted ${variable[1]} to "${variable[2]}" upstream; set it in the vault`,
          );
        }
        return `\${${variable[1]}}`;
      });
  /** Notes a file of the plugin a stdio server runs, to be carried into the package. */
  const carry = (rel) =>
    notes.push(
      `${name}: carry ${rel} into the package at the same path (text only; read it in full)` +
        (upstreamRoot !== undefined ? `: ${upstreamRoot}/${rel}` : ""),
    );
  /**
   * A stdio command or argument naming a file of the plugin — `./x`, `x/y`, `${PLUGIN_ROOT}/x` —
   * rooted at the package directory, its file noted to be carried; anything else as it is.
   */
  const rooted = (text, isCommand) => {
    if (text.startsWith("${PLUGIN_ROOT}/")) {
      carry(text.slice("${PLUGIN_ROOT}/".length));
      return text;
    }
    const relative =
      text.startsWith("./") ||
      (isCommand && !path.isAbsolute(text) && !text.startsWith("${") && text.includes("/"));
    if (!relative) return text;
    const rel = text.replace(/^\.\//, "");
    carry(rel);
    return `\${PLUGIN_ROOT}/${rel}`;
  };

  const type = spec.type ?? spec.transport;
  const transport =
    type === "http" || type === "streamable-http" || type === "streamableHttp"
      ? "http"
      : type === "sse"
        ? "sse"
        : type === "stdio" || (type === undefined && typeof spec.command === "string")
          ? "stdio"
          : type === undefined && typeof spec.url === "string"
            ? "http"
            : null;
  if (transport === null) {
    notes.push(`${id}: its transport cannot be told; not carried`);
    continue;
  }

  const config = { transport };
  if (transport === "stdio") {
    if (typeof spec.command !== "string" || spec.command.trim() === "") {
      notes.push(`${id}: a stdio server without a command; not carried`);
      continue;
    }
    const command = rewrite(spec.command, "command");
    if (command.startsWith("../")) {
      notes.push(`${id}: its command ${command} lies outside the plugin; not carried`);
      continue;
    }
    // A command with a slash is a file (a bare one is looked up on the PATH); an argument is
    // one only when it says so (`./x`).
    config.command = rooted(command, true);
    if (Array.isArray(spec.args)) {
      config.args = spec.args.map((arg) => rooted(rewrite(String(arg), "args"), false));
    }
    const env = {};
    if (isRecord(spec.env)) {
      for (const [key, value] of Object.entries(spec.env))
        env[key] = rewrite(String(value), `env ${key}`);
    }
    for (const variable of Array.isArray(spec.env_vars) ? spec.env_vars : []) {
      if (typeof variable === "string" && VAULT_KEY.test(variable) && variable !== "PLUGIN_ROOT") {
        env[variable] = `\${${variable}}`;
        needKey(variable);
      } else {
        notes.push(
          `${name}: env_vars entry ${JSON.stringify(variable)} is not a vault key; dropped`,
        );
      }
    }
    if (Object.keys(env).length > 0) config.env = env;
    if (typeof spec.cwd === "string") {
      const cwd = rewrite(spec.cwd, "cwd");
      if (cwd.startsWith("../")) {
        notes.push(`${name}: its cwd ${cwd} lies outside the plugin; dropped`);
      } else if (path.isAbsolute(cwd) || cwd.startsWith("${")) {
        config.cwd = cwd;
      } else {
        const rel = cwd.replace(/^\.\/?/, "");
        config.cwd = rel === "" ? "${PLUGIN_ROOT}" : `\${PLUGIN_ROOT}/${rel}`;
      }
    }
  } else {
    const url = typeof spec.url === "string" ? spec.url : "";
    if (!/^https?:\/\//i.test(url)) {
      notes.push(`${id}: its address ${JSON.stringify(url)} is not an http(s) URL; not carried`);
      continue;
    }
    if (/^[a-z]+:\/\/[^/?#]*(\$\{|<)/i.test(url)) {
      notes.push(`${id}: its host is a variable, which a package cannot carry; not carried`);
      continue;
    }
    config.url = rewrite(url, "url");
    const headers = {};
    for (const [header, value] of Object.entries({
      ...(isRecord(spec.headers) ? spec.headers : {}),
      ...(isRecord(spec.http_headers) ? spec.http_headers : {}),
    })) {
      const text = rewrite(String(value), `header ${header}`);
      const literal = /^(Bearer|token)\s+([A-Za-z0-9_\-.]{20,})$/i.exec(text);
      if (literal !== null) {
        const key = `${keyStem(name)}_TOKEN`;
        needKey(key, `${labelOf(name)} token`);
        notes.push(`${name}: upstream had a literal token in ${header}; not carried (set ${key})`);
        headers[header] = `${literal[1]} \${${key}}`;
      } else {
        headers[header] = text;
      }
    }
    for (const [header, variable] of Object.entries(
      isRecord(spec.env_http_headers) ? spec.env_http_headers : {},
    )) {
      if (typeof variable === "string" && VAULT_KEY.test(variable)) {
        headers[header] = `\${${variable}}`;
        needKey(variable);
      }
    }
    const bearerVariable = spec.bearer_token_env_var;
    if (typeof bearerVariable === "string" && VAULT_KEY.test(bearerVariable)) {
      headers.Authorization = `Bearer \${${bearerVariable}}`;
      needKey(bearerVariable);
    }
    if (bearerFor.has(name)) {
      const key = bearerFor.get(name) ?? `${keyStem(name)}_TOKEN`;
      headers.Authorization = `Bearer \${${key}}`;
      needKey(key, `${labelOf(name)} token`);
    }
    if (Object.keys(headers).length > 0) config.headers = headers;
  }

  const upstreamOAuth = isRecord(spec.oauth) ? spec.oauth : undefined;
  const scopes = Array.isArray(spec.scopes)
    ? spec.scopes
    : Array.isArray(upstreamOAuth?.scopes)
      ? upstreamOAuth.scopes
      : undefined;
  if (
    upstreamOAuth !== undefined ||
    scopes !== undefined ||
    spec.oauth_resource !== undefined ||
    oauthFor.has(name)
  ) {
    const oauth = {};
    if (scopes !== undefined) oauth.scopes = scopes.filter((scope) => typeof scope === "string");
    if (typeof upstreamOAuth?.client_id === "string") {
      oauth.client_id = rewrite(upstreamOAuth.client_id, "oauth.client_id");
    }
    if (typeof upstreamOAuth?.client_secret === "string") {
      const secret = rewrite(upstreamOAuth.client_secret, "oauth.client_secret");
      if (secret.includes("${")) {
        oauth.client_secret = secret;
      } else {
        const key = `${keyStem(name)}_CLIENT_SECRET`;
        needKey(key, `${labelOf(name)} OAuth client secret`);
        oauth.client_secret = `\${${key}}`;
        notes.push(
          `${name}: the upstream repository publishes a client secret for this OAuth client; it is not carried: put it in the vault as ${key} to reuse it, or register a client of your own`,
        );
      }
    }
    config.oauth = oauth;
  }
  for (const [from, to] of [
    ["startup_timeout_sec", "connectTimeoutMs"],
    ["tool_timeout_sec", "timeoutMs"],
  ]) {
    if (typeof spec[from] === "number" && spec[from] > 0)
      config[to] = Math.round(spec[from] * 1000);
  }
  if (typeof spec.note === "string" && spec.note.trim() !== "") {
    notes.push(`${name}: upstream note: ${spec.note.trim()}`);
  }

  taken.add(name);
  servers.push({ name, config, ...(setup.length > 0 ? { setup } : {}) });
}

console.log(JSON.stringify({ mcp_servers: servers, notes }, null, 2));

#!/usr/bin/env node
// Reads another coding tool's files for the agent-porting skill so that no secret value enters
// the conversation (and so never the Session's Trace, which an export may carry). It prints by
// allowlist: what it cannot show to be harmless, it does not print.
//
//   node inspect-config.mjs <file>... [--only <key>[,<key>...]] [--keys]
//   node inspect-config.mjs --scan <dir-or-file>...
//   node inspect-config.mjs --show <file>... [--lines <from>-<to>]
//
// A configuration file (JSON, comments and trailing commas tolerated; TOML; YAML) is parsed and
// printed as JSON. Key names print (one shaped like a token prints as `<redacted key:N chars>`);
// numbers, booleans and null print, except a number under a credential key. A string prints only
// when it is
// - a reference, `${VAR}` or `${credential:name}`, with an optional `Bearer ` / `Basic ` in front
//   (a `${VAR:-default}` without its default). Under a credential key the reference keeps its
//   structure only: `Bearer ${<redacted:N chars>}`;
// - the value of a structural key (STRUCTURAL below) that no detector flags. `command` prints
//   its program only, `<program> <redacted:N more words>`. A URL (`url`, `httpUrl`, …) prints its
//   scheme, host and path, its user info and whole query replaced. Prose keys (`description`,
//   `prompt`, `developer_instructions`, `instructions`) print with every flagged line replaced;
//   or
// - an `args` element that is a bare flag (`--verbose`, no `=`), a flag's name before its `=`, or
//   a package or path token (`^[@\w./:~-]+$`, at most 100 characters, no token-shaped or
//   high-entropy part), unless it follows a credential flag (`--api-key`, `--pass`, `-u`, …);
// - an item of `env_vars`, when it is a variable name.
// Every other string prints as `<redacted:N chars>`. A key matching CREDENTIAL redacts whatever
// it holds, and every key inside it. `~/.claude.json` prints only its MCP servers, top level and
// per project. `--only` keeps the named top-level keys (dotted for a nested one). A file that
// does not parse prints "could not parse <file> (line N)" and its key names, never its content;
// `--keys` asks for that view outright.
//
// `--scan` reads text files (a folder recursively) and prints `file:line: <kind>` for each line a
// detector flags, never the line; a file by a credential-store name prints `file: <kind>`
// unread. It exits 1 when it flags anything, 0 when nothing. `--show` prints a text file with
// each flagged line replaced whole by `<redacted line: kind>` (a private key block to its end).
// Credential stores are refused unread everywhere (REFUSED). Built-in modules only.
import fs from "node:fs";
import path from "node:path";

const CREDENTIAL =
  /key|token|secret|password|passwd|pass|pwd|passphrase|private|auth|credential|cookie|bearer/i;
/** Key names the pattern catches that hold a count or a setting, never a credential. */
const NOT_CREDENTIAL = /tokens?_?(limit|budget|count|window)|max_?\w*tokens?$|^tokens$|key_?bind/i;
/**
 * The keys whose string values print (after the detectors). Hook event names are listed
 * because a few tools put a command string straight under one.
 */
const STRUCTURAL = new Set([
  // identity and shape
  "name",
  "id",
  "title",
  "type",
  "transport",
  "kind",
  "format",
  "version",
  "serverName",
  "matcher",
  "trigger",
  // a process
  "command",
  "cwd",
  "timeout",
  "enabled",
  "disabled",
  // model and permission settings the mapping reads
  "model",
  "model_provider",
  "model_reasoning_effort",
  "reasoningEffort",
  "effortLevel",
  "effort",
  "thinkingLevel",
  "approval_policy",
  "approvalMode",
  "sandbox_mode",
  "defaultMode",
  "permissionMode",
  // hook events
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "PreCompact",
]);
const URL_KEYS = new Set(["url", "httpUrl", "baseUrl", "base_url", "endpoint"]);
const PROSE_KEYS = new Set(["description", "prompt", "developer_instructions", "instructions"]);
const NAME_LIST_KEYS = new Set(["env_vars"]);
const TOKEN_SHAPES =
  /(sk-ant-[\w-]{16,}|sk-[\w-]{16,}|(sk|rk|pk)_(live|test)_[\w]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abposr]-[\w-]{10,}|glpat-[\w-]{16,}|hf_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/;
const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
/** Files that are credential stores by name: never read, by any mode. */
const REFUSED = [
  /^\.?env$/i,
  /^\.env\..*/i,
  /\.env$/i,
  /^\.envrc$/i,
  /^auth\.json$/i,
  /^\.?credentials?(\.|$)/i,
  /oauth.*tokens?.*\.json$/i,
  /^trust\.json$/i,
  /\.(pem|key|p12|pfx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^\.(netrc|npmrc|pypirc|pgpass)$/i,
];
const isRefused = (file) => REFUSED.some((re) => re.test(path.basename(file)));

const chars = (s) => `<redacted:${s.length} chars>`;
const isCredentialKey = (k) => CREDENTIAL.test(k) && !NOT_CREDENTIAL.test(k);
const REFERENCE =
  /^((?:Bearer|Basic|Token) )?\$\{(credential:)?([A-Za-z_][A-Za-z0-9_.-]*)(:-[^}]*)?\}$/i;

/** A part that reads as random: letters and digits mixed over 12 characters, or 40 of anything. */
const highEntropy = (part) =>
  (part.length >= 12 && /[0-9]/.test(part) && /[A-Za-z]/.test(part)) || part.length >= 40;
const tokenish = (s) => TOKEN_SHAPES.test(s) || s.split(/[/.:@~_-]+/).some(highEntropy);

/**
 * A package or path token: short, plain, nothing in it shaped like a token. A `${VAR}` inside
 * (`${CLAUDE_PLUGIN_ROOT}/server.js`) counts as a plain part: a variable's name is no secret.
 */
const pathToken = (s) => {
  const plain = s.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, "VAR");
  return plain.length <= 100 && /^[@\w./:~-]+$/.test(plain) && !tokenish(plain);
};

// ---- Detectors (shared by structured values, --scan and --show) ------------------------------

const valueLooksSet = (v) =>
  v !== "" &&
  !REFERENCE.test(v) &&
  !/^\$[A-Za-z_]\w*$/.test(v) &&
  !/^(true|false|null|none|~|\d+(\.\d+)?)$/i.test(v) &&
  !/^(bearer|basic|token)$/i.test(v) &&
  !/^[[{(<]/.test(v);

/**
 * The kind of credential a line carries, or null. `code`: an unquoted right-hand side is an
 * expression (JavaScript, TypeScript, Python), not a literal.
 */
function lineKind(line, code) {
  if (PEM.test(line)) return "private key block";
  if (TOKEN_SHAPES.test(line)) return "token-shaped string";
  if (/[a-z][a-z0-9+.-]*:\/\/[^\s/@:"']+:[^\s/@"']+@/i.test(line)) return "URL user info";
  for (const m of line.matchAll(/[?&]([^=&\s#"']+)=([^&\s#"']+)/g)) {
    if (isCredentialKey(m[1]) && valueLooksSet(m[2])) return "URL credential parameter";
  }
  if (/(^|[\s"'(])(-u|--user)(\s+|=)["']?[^\s:"']+:[^\s"']+/.test(line)) return "user:password";
  // mysql -p<password>; not -p8080, find's -print / -prune, mkdir -p, a -p <value> pair.
  const attached = /(^|[\s"'])-p(?![\s=]|\d+\b|rint|rune|ath|erm|arents)["']?(?!\$)([^\s"']{4,})/;
  if (attached.test(line)) {
    return "-p password";
  }
  for (const m of line.matchAll(/(^|[\s"'(=])--?([A-Za-z][\w.-]*)(=|\s+)["']?([^\s"']*)/g)) {
    if (isCredentialKey(m[2]) && valueLooksSet(m[4]) && !m[4].startsWith("-"))
      return "credential flag";
  }
  if (/\bBearer\s+(?!\$)[A-Za-z0-9._~+/=-]{8,}/i.test(line)) return "bearer credential";
  if (/\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}/.test(line))
    return "basic credential";
  const quoted = /(["']?)([A-Za-z_][\w.-]*)\1\s*[:=]\s*(["'])(.*?)\3/g;
  for (const m of line.matchAll(quoted)) {
    if (isCredentialKey(m[2]) && valueLooksSet(m[4])) return "credential assignment";
  }
  if (!code) {
    const bare = /(["']?)([A-Za-z_][\w.-]*)\1\s*[:=]\s*([^\s"',}\]]+)/g;
    for (const m of line.matchAll(bare)) {
      if (isCredentialKey(m[2]) && valueLooksSet(m[3])) return "credential assignment";
    }
  }
  return null;
}

/** A text's flagged lines, each replaced whole; a private key block is replaced to its end. */
function maskLines(text, code) {
  const out = [];
  let inKey = false;
  for (const line of text.split(/\r?\n/)) {
    if (inKey) {
      out.push("<redacted line: private key block>");
      if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) inKey = false;
      continue;
    }
    const kind = lineKind(line, code);
    if (kind === "private key block" && !/-----END /.test(line)) inKey = true;
    out.push(kind === null ? line : `<redacted line: ${kind}>`);
  }
  return out.join("\n");
}

// ---- Structured values -----------------------------------------------------------------------

/** A reference, whole outside a credential key, its structure only inside one. */
function reference(s, credential) {
  const m = REFERENCE.exec(s);
  const scheme = m[1] ?? "";
  const kind = m[2] ?? "";
  if (credential) return `${scheme}\${${kind}${chars(m[3])}}`;
  return `${scheme}\${${kind}${m[3]}${m[4] ? ":-<redacted:default>" : ""}}`;
}

function url(s) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
  if (m === null) return chars(s);
  const [, scheme, authority, rest, query, hash] = m;
  const at = authority.lastIndexOf("@");
  const host = at === -1 ? authority : `<redacted:userinfo>@${authority.slice(at + 1)}`;
  const pathPart = rest
    .split("/")
    .map((seg) => (seg === "" || pathToken(seg) ? seg : chars(seg)))
    .join("/");
  return `${scheme}${host}${pathPart}${query ? "?<redacted:query>" : ""}${hash ? "#<redacted:fragment>" : ""}`;
}

/** A shell line: its program, and how many more words it has. */
function commandLine(s) {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const program = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
  if (program === -1) return chars(s);
  const head = pathToken(words[program]) ? words[program] : chars(words[program]);
  const more = words.length - 1;
  return more === 0 ? head : `${head} <redacted:${more} more word${more === 1 ? "" : "s"}>`;
}

const CREDENTIAL_FLAG = (w) =>
  typeof w === "string" &&
  (/^(-u|--user|-p)$/.test(w) ||
    (/^--?[A-Za-z][\w.-]*$/.test(w) && isCredentialKey(w.replace(/^-+/, ""))));

function arg(item, prev) {
  if (CREDENTIAL_FLAG(prev)) return REFERENCE.test(item) ? reference(item, true) : chars(item);
  if (REFERENCE.test(item)) return reference(item, false);
  if (/^--?[A-Za-z][\w.-]*$/.test(item)) return item;
  const flag = /^(--?[A-Za-z][\w.-]*)=(.*)$/s.exec(item);
  if (flag)
    return `${flag[1]}=${REFERENCE.test(flag[2]) ? reference(flag[2], isCredentialKey(flag[1])) : chars(flag[2])}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(item)) return url(item);
  return pathToken(item) && lineKind(item, false) === null ? item : chars(item);
}

function stringAt(s, key, credential) {
  if (credential) return REFERENCE.test(s) ? reference(s, true) : chars(s);
  if (REFERENCE.test(s)) return reference(s, false);
  if (URL_KEYS.has(key)) return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? url(s) : chars(s);
  if (key === "command") return s.includes(" ") ? commandLine(s) : pathToken(s) ? s : chars(s);
  if (PROSE_KEYS.has(key)) return maskLines(s, false);
  if (STRUCTURAL.has(key))
    return s.length <= 200 && lineKind(s, false) === null && !TOKEN_SHAPES.test(s) ? s : chars(s);
  if (NAME_LIST_KEYS.has(key) && /^[A-Z_][A-Z0-9_]*$/.test(s)) return s;
  return chars(s);
}

const safeKey = (k) => (tokenish(k) && !k.startsWith("/") ? `<redacted key:${k.length} chars>` : k);

function mask(value, key, credential, args) {
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      typeof item === "string" && args && !credential
        ? arg(item, value[i - 1])
        : mask(item, key, credential, false),
    );
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[safeKey(k)] = mask(
        v,
        k,
        credential || isCredentialKey(k),
        k === "args" || (k === "command" && Array.isArray(v)),
      );
    }
    return out;
  }
  if (typeof value === "string") return stringAt(value, key, credential);
  if (typeof value === "number" && credential) return `<redacted:number>`;
  return value;
}

/** An error that knows the line it happened on, and nothing of the file's content. */
function parseError(line) {
  const err = new Error("parse");
  err.line = line;
  return err;
}

// ---- JSON (with comments) -------------------------------------------------------------------

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        let j = i + 1;
        while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        out += text.slice(i, j + 1);
        i = j;
      } else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        out += "\n";
      } else if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) throw parseError(text.slice(0, i).split("\n").length);
        // Keep the comment's line breaks, so a later error still names the right line.
        out += text.slice(i, end + 2).replace(/[^\n]/g, "");
        i = end + 1;
      } else out += c;
    }
    const cleaned = out.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(cleaned);
    } catch {
      throw parseError(cleaned.slice(0, jsonErrorOffset(cleaned)).split("\n").length);
    }
  }
}

/** Where strict JSON stops being valid: a scan that reports an offset and nothing else. */
function jsonErrorOffset(text) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] ?? "")) i++;
  };
  const bad = () => {
    throw i;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      ws();
      if (text[i] === close) return i++;
      for (;;) {
        if (c === "{") {
          ws();
          if (text[i] !== '"') bad();
          string();
          ws();
          if (text[i] !== ":") bad();
          i++;
        }
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === close) return i++;
        else bad();
      }
    }
    if (c === '"') return string();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (m === null) bad();
    i += m[0].length;
  };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\n") bad();
      i += text[i] === "\\" ? 2 : 1;
    }
    if (i >= text.length) bad();
    i++;
  };
  try {
    value();
    ws();
    return i < text.length ? i : text.length;
  } catch (at) {
    return typeof at === "number" ? at : 0;
  }
}

// ---- TOML -----------------------------------------------------------------------------------

function parseToml(text) {
  const root = {};
  let cur = root;
  let i = 0;
  const fail = () => {
    throw parseError(text.slice(0, i).split("\n").length);
  };
  const ws = () => {
    while (text[i] === " " || text[i] === "\t") i++;
  };
  const wsnl = () => {
    for (;;) {
      ws();
      if (text[i] === "#") while (i < text.length && text[i] !== "\n") i++;
      if (text[i] === "\n" || text[i] === "\r") i++;
      else break;
    }
  };
  const basic = (multi) => {
    let s = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      if (multi ? text.startsWith('"""', i) : text[i] === '"') {
        i += multi ? 3 : 1;
        if (multi && text[i] === '"') {
          s += '"';
          i++;
        }
        return s;
      }
      const c = text[i++];
      if (!multi && c === "\n") fail("newline in string");
      if (c !== "\\") {
        s += c;
        continue;
      }
      const e = text[i++];
      if (multi && (e === "\n" || e === "\r" || e === " " || e === "\t")) {
        while (/\s/.test(text[i] ?? "")) i++;
        continue;
      }
      const map = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" };
      if (e in map) s += map[e];
      else if (e === "u" || e === "U") {
        const len = e === "u" ? 4 : 8;
        s += String.fromCodePoint(parseInt(text.slice(i, i + len), 16));
        i += len;
      } else fail("bad escape");
    }
  };
  const literal = (multi) => {
    const end = multi ? "'''" : "'";
    const at = text.indexOf(end, i);
    if (at === -1) fail("unterminated string");
    let s = text.slice(i, at);
    i = at + end.length;
    if (multi && text[i] === "'") {
      s += "'";
      i++;
    }
    if (!multi && s.includes("\n")) fail("newline in string");
    return s;
  };
  const string = () => {
    if (text.startsWith('"""', i)) {
      i += 3;
      if (text[i] === "\r") i++;
      if (text[i] === "\n") i++;
      return basic(true);
    }
    if (text.startsWith("'''", i)) {
      i += 3;
      if (text[i] === "\r") i++;
      if (text[i] === "\n") i++;
      return literal(true);
    }
    if (text[i] === '"') {
      i++;
      return basic(false);
    }
    i++;
    return literal(false);
  };
  const keyPath = () => {
    const parts = [];
    for (;;) {
      ws();
      if (text[i] === '"' || text[i] === "'") parts.push(string());
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
        if (m === null) fail("bad key");
        parts.push(m[0]);
        i += m[0].length;
      }
      ws();
      if (text[i] !== ".") return parts;
      i++;
    }
  };
  const value = () => {
    const c = text[i];
    if (c === '"' || c === "'") return string();
    if (c === "[") {
      i++;
      const arr = [];
      for (;;) {
        wsnl();
        if (text[i] === "]") {
          i++;
          return arr;
        }
        arr.push(value());
        wsnl();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("expected , or ]");
      }
    }
    if (c === "{") {
      i++;
      const obj = {};
      for (;;) {
        wsnl();
        if (text[i] === "}") {
          i++;
          return obj;
        }
        const k = keyPath();
        ws();
        if (text[i] !== "=") fail("expected =");
        i++;
        ws();
        assign(obj, k, value());
        wsnl();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") fail("expected , or }");
      }
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(i));
    if (m === null) fail("missing value");
    i += m[0].length;
    const raw = m[0];
    // A local date-time may carry a space before its time part.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && /^ \d{2}:/.test(text.slice(i))) {
      const t = /^ [^\s,\]}#]+/.exec(text.slice(i))[0];
      i += t.length;
      return raw + t;
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    const num = Number(raw.replace(/_/g, ""));
    return Number.isFinite(num) && /^[+-]?(\d|0x|0o|0b)/.test(raw) && !/^\d{4}-/.test(raw)
      ? num
      : raw;
  };
  const table = (obj, parts) => {
    let t = obj;
    for (const p of parts) {
      if (t[p] === undefined) t[p] = {};
      t = Array.isArray(t[p]) ? t[p][t[p].length - 1] : t[p];
      if (t === null || typeof t !== "object") fail(`key ${p} is not a table`);
    }
    return t;
  };
  const assign = (obj, parts, v) => {
    const t = table(obj, parts.slice(0, -1));
    t[parts[parts.length - 1]] = v;
  };
  for (;;) {
    wsnl();
    if (i >= text.length) return root;
    if (text.startsWith("[[", i)) {
      i += 2;
      const parts = keyPath();
      if (!text.startsWith("]]", i)) fail("expected ]]");
      i += 2;
      const parent = table(root, parts.slice(0, -1));
      const last = parts[parts.length - 1];
      if (parent[last] === undefined) parent[last] = [];
      if (!Array.isArray(parent[last])) fail(`${last} is not an array of tables`);
      cur = {};
      parent[last].push(cur);
    } else if (text[i] === "[") {
      i++;
      const parts = keyPath();
      if (text[i] !== "]") fail("expected ]");
      i++;
      cur = table(root, parts);
    } else {
      const k = keyPath();
      if (text[i] !== "=") fail("expected =");
      i++;
      ws();
      assign(cur, k, value());
    }
    ws();
    if (text[i] === "#") while (i < text.length && text[i] !== "\n") i++;
    if (i < text.length && text[i] !== "\n" && text[i] !== "\r") fail("expected end of line");
  }
}

// ---- YAML (the block subset configuration files use) ----------------------------------------

function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, n) => {
    let quote = null;
    let cut = raw.length;
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j];
      if (quote) {
        if (c === quote && !(quote === '"' && raw[j - 1] === "\\")) quote = null;
      } else if (c === '"' || c === "'") {
        if (j === 0 || /[\s:\[{,-]/.test(raw[j - 1])) quote = c;
      } else if (c === "#" && (j === 0 || /\s/.test(raw[j - 1]))) {
        cut = j;
        break;
      }
    }
    const content = raw.slice(0, cut).trimEnd();
    if (content.trim() === "" || /^(---|\.\.\.)\s*$/.test(content)) return;
    if (/^\t/.test(content)) throw parseError(n + 1);
    lines.push({
      indent: content.length - content.trimStart().length,
      text: content.trim(),
      n: n + 1,
      raw,
    });
  });
  let at = 0;
  const fail = () => {
    throw parseError(lines[Math.min(at, lines.length - 1)]?.n);
  };
  const isItem = (t) => t === "-" || t.startsWith("- ");
  const splitKey = (t) => {
    let key;
    let rest;
    if (t[0] === '"' || t[0] === "'") {
      const end = t.indexOf(t[0], 1);
      if (end === -1) return null;
      key = t.slice(1, end);
      rest = t.slice(end + 1);
      if (!rest.startsWith(":")) return null;
      rest = rest.slice(1);
    } else {
      const m = /^([^\s:][^:]*?):(\s|$)/.exec(t);
      if (m === null) return null;
      key = m[1];
      rest = t.slice(m[0].length - (m[2] === "" ? 0 : 1));
    }
    return { key, rest: rest.trim() };
  };
  const scalar = (t) => {
    t = t.replace(/^(![^\s]*\s+)+/, "");
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1"));
      } catch {
        fail();
      }
    }
    if (t.startsWith("'")) {
      if (!t.endsWith("'") || t.length < 2) fail("unterminated string");
      return t.slice(1, -1).replace(/''/g, "'");
    }
    if (t.startsWith("[") || t.startsWith("{")) return flow(t);
    if (/^(null|~)?$/.test(t)) return null;
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
    if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    return t;
  };
  const flow = (t) => {
    let j = 0;
    const item = () => {
      while (t[j] === " ") j++;
      if (t[j] === "[") {
        j++;
        const arr = [];
        for (;;) {
          while (t[j] === " ") j++;
          if (t[j] === "]") {
            j++;
            return arr;
          }
          arr.push(item());
          while (t[j] === " ") j++;
          if (t[j] === ",") j++;
          else if (t[j] !== "]") fail("bad flow sequence");
        }
      }
      if (t[j] === "{") {
        j++;
        const obj = {};
        for (;;) {
          while (t[j] === " ") j++;
          if (t[j] === "}") {
            j++;
            return obj;
          }
          const k = item();
          while (t[j] === " ") j++;
          if (t[j] !== ":") fail("bad flow mapping");
          j++;
          obj[String(k)] = item();
          while (t[j] === " ") j++;
          if (t[j] === ",") j++;
          else if (t[j] !== "}") fail("bad flow mapping");
        }
      }
      if (t[j] === '"' || t[j] === "'") {
        const q = t[j];
        let k = j + 1;
        while (k < t.length && (t[k] !== q || (q === '"' && t[k - 1] === "\\"))) k++;
        const s = t.slice(j, k + 1);
        j = k + 1;
        return scalar(s);
      }
      const m = /^[^,\]}:]*(:(?! |,|]|}|$)[^,\]}:]*)*/.exec(t.slice(j));
      j += m[0].length;
      return scalar(m[0].trim());
    };
    const v = item();
    if (t.slice(j).trim() !== "") fail("text after a flow collection");
    return v;
  };
  const blockScalar = (header, indent) => {
    const body = [];
    while (at < lines.length && lines[at].indent > indent) body.push(lines[at++].raw);
    const min = Math.min(...body.map((l) => l.length - l.trimStart().length));
    const textLines = body.map((l) => l.slice(min));
    return header.startsWith(">") ? textLines.join(" ") : textLines.join("\n");
  };
  const inline = (rest, indent) => {
    if (/^[|>][-+0-9]*$/.test(rest)) return blockScalar(rest, indent);
    let t = rest;
    if (/^[\[{]/.test(t)) {
      const depth = (s) =>
        [...s].reduce((d, c) => d + ("[{".includes(c) ? 1 : "]}".includes(c) ? -1 : 0), 0);
      while (depth(t) > 0 && at < lines.length) t += " " + lines[at++].text;
    }
    return scalar(t);
  };
  const block = (indent) => {
    if (at >= lines.length) return null;
    return isItem(lines[at].text) ? sequence(lines[at].indent) : mapping(lines[at].indent);
  };
  const child = (indent) => {
    if (
      at < lines.length &&
      (lines[at].indent > indent || (lines[at].indent === indent && isItem(lines[at].text)))
    ) {
      return block(lines[at].indent);
    }
    return null;
  };
  const sequence = (indent) => {
    const arr = [];
    while (at < lines.length && lines[at].indent === indent && isItem(lines[at].text)) {
      const line = lines[at];
      const rest = line.text.slice(1).trimStart();
      if (rest === "") {
        at++;
        arr.push(lines[at] && lines[at].indent > indent ? block(lines[at].indent) : null);
      } else if (splitKey(rest) !== null && !/^[\[{"']/.test(rest)) {
        // A mapping that starts on the item's line: read it as if it began at its own column.
        const col = indent + (line.text.length - rest.length);
        lines[at] = { ...line, indent: col, text: rest };
        arr.push(mapping(col));
      } else {
        at++;
        arr.push(inline(rest, indent));
      }
    }
    return arr;
  };
  const mapping = (indent) => {
    const obj = {};
    while (at < lines.length && lines[at].indent === indent && !isItem(lines[at].text)) {
      const kv = splitKey(lines[at].text);
      if (kv === null) fail("expected key: value");
      at++;
      obj[kv.key] = kv.rest === "" ? child(indent) : inline(kv.rest, indent);
    }
    if (at < lines.length && lines[at].indent > indent) fail("unexpected indentation");
    return obj;
  };
  const doc = block(0);
  if (at < lines.length) fail("unexpected content");
  return doc;
}

// ---- Key names only (a file that does not parse) --------------------------------------------

function keysOnly(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^\s*(\/\/|#).*$/, "");
    if (line.trim() === "") continue;
    const header = /^(\s*)(\[\[?)([^\]]+)(\]\]?)\s*$/.exec(line);
    if (header) {
      const parts = header[3].split(".").map((p) => safeKey(p.trim().replace(/^["']|["']$/g, "")));
      out.push(`${header[1]}${header[2]}${parts.join(".")}${header[4]}`);
      continue;
    }
    const m = /^(\s*(?:-\s+)?)("[^"]*"|'[^']*'|[A-Za-z0-9_.@$\/-]+)\s*([:=])/.exec(line);
    if (m) out.push(`${m[1]}${safeKey(m[2].replace(/^["']|["']$/g, ""))}${m[3]} …`);
    else if (/^\s*-/.test(line)) out.push(`${/^\s*/.exec(line)[0]}- …`);
  }
  return out.join("\n");
}

// ---- --scan and --show -----------------------------------------------------------------------

/** Code, where an unquoted right-hand side is an expression rather than a literal. */
const isCode = (name) => /\.(m?[jt]s|cjs|[jt]sx|py)$/i.test(name);

/** The lines of one text file a detector flags, as `[line, kind]`; null for a binary file. */
function flaggedLines(file) {
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) return null;
  const hits = [];
  let inKey = false;
  buf
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, n) => {
      if (inKey) {
        if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) inKey = false;
        return;
      }
      const kind = lineKind(line, isCode(file));
      if (kind === null) return;
      if (kind === "private key block" && !/-----END /.test(line)) inKey = true;
      hits.push([n + 1, kind]);
    });
  return hits;
}

/** Folders a tool fills with transcripts, history and caches: never part of a port. */
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "file-history",
  "shell-snapshots",
  "paste-cache",
  "image-cache",
  "debug",
  "cache",
  "sessions",
  "statsig",
  "todos",
]);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

function scan(targets) {
  let found = 0;
  const visit = (target, root) => {
    const rel = path.relative(root, target) || path.basename(target);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (err) {
      console.log(`${rel}: ${err.code ?? "unreadable"}`);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) {
        if (!SKIPPED_DIRS.has(entry)) visit(path.join(target, entry), root);
      }
      return;
    }
    if (!stat.isFile() || /\.jsonl$/i.test(target)) return;
    if (isRefused(target)) {
      found++;
      console.log(`${rel}: credential file (not read)`);
      return;
    }
    if (stat.size > MAX_SCAN_BYTES) {
      console.log(`${rel}: larger than 2 MiB (not scanned; not part of a port)`);
      return;
    }
    const hits = flaggedLines(target);
    for (const [line, kind] of hits ?? []) {
      found++;
      console.log(`${rel}:${line}: ${kind}`);
    }
  };
  for (const target of targets) {
    const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
    visit(target, stat?.isDirectory() ? target : path.dirname(target));
  }
  console.log(
    found === 0
      ? "# no credential-looking value"
      : `# ${found} finding(s): a real value becomes a \${KEY} Vault reference or goes; read a flagged file with --show`,
  );
  return found === 0 ? 0 : 1;
}

function show(files, range) {
  let status = 0;
  for (const file of files) {
    if (isRefused(file)) {
      console.log(`# ${file}: a credential store; not read`);
      status = 3;
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (err) {
      console.log(`# ${file}: ${err.code ?? "unreadable"}`);
      status = 1;
      continue;
    }
    if (buf.includes(0)) {
      console.log(`# ${file}: not a text file`);
      continue;
    }
    let lines = maskLines(buf.toString("utf8"), isCode(file)).split("\n");
    const total = lines.length;
    if (range !== null) lines = lines.slice(range[0] - 1, range[1]);
    const span =
      range === null ? "" : `, lines ${range[0]}-${Math.min(range[1], total)} of ${total}`;
    console.log(`# ${file} (flagged lines masked${span})\n${lines.join("\n")}`);
  }
  return status;
}

// ---- Main ------------------------------------------------------------------------------------

const USAGE =
  "usage: node inspect-config.mjs <file>... [--only <key>[,<key>...]] [--keys]\n" +
  "       node inspect-config.mjs --scan <dir-or-file>...\n" +
  "       node inspect-config.mjs --show <file>... [--lines <from>-<to>]";

const args = process.argv.slice(2);
if (args[0] === "--scan") {
  if (args.length < 2) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(scan(args.slice(1)));
}
if (args[0] === "--show") {
  const rest = args.slice(1);
  let range = null;
  const at = rest.indexOf("--lines");
  if (at !== -1) {
    const m = /^(\d+)-(\d+)$/.exec(rest[at + 1] ?? "");
    if (m === null) {
      console.error(USAGE);
      process.exit(2);
    }
    range = [Number(m[1]), Number(m[2])];
    rest.splice(at, 2);
  }
  if (rest.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(show(rest, range));
}

const files = [];
let only = null;
let keys = false;
for (let a = 0; a < args.length; a++) {
  if (args[a] === "--only") only = (args[++a] ?? "").split(",").filter(Boolean);
  else if (args[a] === "--keys") keys = true;
  else files.push(args[a]);
}
if (files.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

/** `~/.claude.json`: its MCP servers, and nothing else of the account state it holds. */
function claudeJsonView(c) {
  const projects = {};
  for (const [dir, p] of Object.entries(c.projects ?? {})) {
    if (p && typeof p === "object" && p.mcpServers && Object.keys(p.mcpServers).length > 0) {
      projects[dir] = { mcpServers: p.mcpServers };
    }
  }
  return { mcpServers: c.mcpServers ?? {}, projects };
}

function pick(data, paths) {
  const out = {};
  for (const p of paths) {
    let v = data;
    for (const seg of p.split(".")) v = v !== null && typeof v === "object" ? v[seg] : undefined;
    if (v !== undefined) out[p] = v;
  }
  return out;
}

let status = 0;
for (const file of files) {
  if (isRefused(file)) {
    console.log(`# ${file}: a credential store; not read`);
    status = 3;
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    console.log(`# ${file}: ${err.code ?? "unreadable"}`);
    status = 1;
    continue;
  }
  const base = path.basename(file);
  const ext = path.extname(base).toLowerCase();
  const format =
    ext === ".toml"
      ? "toml"
      : ext === ".yml" || ext === ".yaml"
        ? "yaml"
        : ext === ".json" || ext === ".jsonc"
          ? "json"
          : null;
  if (format === null) {
    console.log(`# ${file}: not a JSON, TOML or YAML file; read text with --show`);
    status = 1;
    continue;
  }
  if (keys) {
    console.log(`# ${file} (${format}, key names only)\n${keysOnly(text)}`);
    continue;
  }
  let data;
  try {
    data =
      format === "toml" ? parseToml(text) : format === "yaml" ? parseYaml(text) : parseJson(text);
  } catch (err) {
    const line = err?.line ?? null;
    console.log(
      `# could not parse ${file}${line ? ` (line ${line})` : ""}; key names only\n${keysOnly(text)}`,
    );
    status = 1;
    continue;
  }
  if (base === ".claude.json") data = claudeJsonView(data ?? {});
  if (only !== null) data = pick(data ?? {}, only);
  console.log(`# ${file} (${format})\n${JSON.stringify(mask(data, "", false, false), null, 2)}`);
}
process.exit(status);

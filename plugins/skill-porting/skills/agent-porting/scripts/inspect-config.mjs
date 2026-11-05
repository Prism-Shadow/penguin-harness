#!/usr/bin/env node
// Prints another coding tool's configuration file with every credential masked, so its values
// never enter the conversation (and so never the Session's Trace, which an export may carry).
//
//   node inspect-config.mjs <file>... [--only <key>[,<key>...]] [--keys]
//   node inspect-config.mjs --scan <dir>
//   node inspect-config.mjs --show <file>...
//
// The format comes from the file name: JSON (comments and trailing commas tolerated), TOML or
// YAML. The file is parsed and printed as JSON, with these values replaced by
// `<redacted:NAME>`, NAME being the key, flag or parameter that held it:
// - every value under a key matching key|token|secret|password|passwd|auth|credential|cookie|
//   bearer (case-insensitive), and every value inside such a key's object or list;
// - every value of an `env`, `headers` or `http_headers` map;
// - in any string: a `--<name>=value` or `--<name> value` argument, a `NAME=value` assignment
//   and a `Name: value` header whose name matches the pattern, a `Bearer` / `Basic` / `Token`
//   credential, the user info of a URL and its query parameters of those names, and anything
//   shaped like a well-known API token.
// A value that is only a reference stays as it is: `${VAR}`, `$VAR`, `${credential:name}`, with
// an optional `Bearer ` in front (a `${VAR:-default}` keeps its name, not its default). So does
// a variable *name* where the key says it holds one (`bearer_token_env_var`, `env_key`,
// `env_vars`, `env_http_headers`).
// `~/.claude.json` prints only its MCP servers (top level and per project), never the account
// state around them. `--only` keeps the named top-level keys (dotted for a nested one). A file
// that cannot be parsed prints its key names only (`--keys` asks for that view outright). A
// credential store (`.env`, `auth.json`, `.credentials.*`, an OAuth token cache, `trust.json`)
// is refused unread.
// `--scan <dir>` checks a folder about to be imported: it prints every line of its text files
// where a credential-looking value sits, with the value masked, and exits 1 when there is one,
// 0 when the folder is clean. `--show <file>...` prints a whole text file (a script, a Markdown
// file `--scan` flagged) with those values masked the same way. Built-in modules only.
import fs from "node:fs";
import path from "node:path";

const CREDENTIAL = /key|token|secret|password|passwd|auth|credential|cookie|bearer/i;
/** Key names the pattern catches that hold a count or a setting, never a credential. */
const NOT_CREDENTIAL =
  /tokens?_?(limit|budget|count|window)|max_?\w*tokens?$|^tokens$|key_?bind|^author$/i;
/** Keys whose values are the *names* of environment variables, not their values. */
const NAME_HOLDER = /env_?vars?$|env_?key$|envvar$|env_http_headers$/i;
/** Maps whose every value is a credential position. */
const SECRET_MAP = /^(env|headers|http_headers|httpheaders)$/i;
/** Keys under a credential object that never hold one. */
const SAFE_CHILD = /^(scopes?|type|enabled|client_?id)$/i;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const URL_START = /^[a-z][a-z0-9+.-]*:\/\//i;
const TOKEN_SHAPES =
  /\b(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g;
const REFUSED = [
  /^\.env(\..*)?$/i,
  /^auth\.json$/i,
  /^\.?credentials?(\.|$)/i,
  /oauth.*tokens?.*\.json$/i,
  /^trust\.json$/i,
];

const redacted = (name) => `<redacted:${name}>`;
const isCredentialKey = (k) => CREDENTIAL.test(k) && !NOT_CREDENTIAL.test(k);
const masked = (v) => v.startsWith("<redacted:");

/** `${VAR}`, `$VAR`, `${credential:x}` and `{{x}}` references removed. */
const withoutReferences = (s) =>
  s
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "")
    .replace(/\{\{[^}]*\}\}/g, "");

/** A value that is nothing but references, with at most an auth scheme in front. */
const onlyReferences = (s) =>
  s !== withoutReferences(s) && /^\s*(bearer|basic|token)?\s*$/i.test(withoutReferences(s));

/** A kept reference never shows the default it falls back to. */
const hideDefaults = (s) =>
  s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-[^}]*\}/g, "${$1:-<redacted:default>}");

function maskUrl(s) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]*@)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
  if (m === null) return s;
  const [, scheme, userinfo, rest, query, hash] = m;
  const params = (query ?? "")
    .slice(1)
    .split("&")
    .filter((p) => p !== "")
    .map((p) => {
      const at = p.indexOf("=");
      const name = at === -1 ? p : p.slice(0, at);
      const value = at === -1 ? "" : p.slice(at + 1);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {}
      return isCredentialKey(decoded) && value !== "" && !onlyReferences(value)
        ? `${name}=${redacted(decoded)}`
        : p;
    });
  return `${scheme}${userinfo ? `${redacted("userinfo")}@` : ""}${rest}${params.length ? `?${params.join("&")}` : ""}${hash ?? ""}`;
}

/** The credentials a free-standing string may carry, masked in place. */
function maskInline(s) {
  if (URL_START.test(s)) return maskUrl(s);
  let out = s
    .replace(/(^|\s)(--?[A-Za-z0-9_.-]+)=(\S+)/g, (all, lead, flag, value) =>
      isCredentialKey(flag) && !onlyReferences(value) && !masked(value)
        ? `${lead}${flag}=${redacted(flag.replace(/^-+/, ""))}`
        : all,
    )
    .replace(/(^|[\s"'])([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g, (all, lead, name, value) =>
      isCredentialKey(name) && !onlyReferences(value) && !masked(value)
        ? `${lead}${name}=${redacted(name)}`
        : all,
    )
    .replace(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/, (all, name, value) =>
      isCredentialKey(name) && !onlyReferences(value) ? `${name}: ${redacted(name)}` : all,
    )
    .replace(
      /\b(bearer)\s+(?!\$)([A-Za-z0-9._~+\/=-]{8,})/gi,
      (all, scheme) => `${scheme} ${redacted("bearer")}`,
    )
    .replace(
      /\bBasic\s+(?=[A-Za-z0-9+\/]*[0-9+\/=])([A-Za-z0-9+\/]{12,}={0,2})/g,
      () => `Basic ${redacted("basic")}`,
    )
    .replace(TOKEN_SHAPES, () => redacted("token"));
  out = out.replace(/(https?:\/\/\S+)/gi, (url) => maskUrl(url));
  return out;
}

/**
 * One string at `key`. `names`: the position holds variable names; `sensitive`: it holds
 * credentials.
 */
function maskString(s, key, { names, sensitive }) {
  if (names) return VAR_NAME.test(s) ? s : redacted(key);
  if (sensitive) {
    if (onlyReferences(s)) return hideDefaults(s);
    // An endpoint under a credential key (an OAuth `tokenUrl`) is an address, not a secret.
    if (/(url|uri)$/i.test(key) && URL_START.test(s)) return maskUrl(s);
    return redacted(key);
  }
  return maskInline(s);
}

function mask(value, key, ctx) {
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      const prev = value[i - 1];
      const flagged =
        typeof prev === "string" &&
        /^--?[A-Za-z0-9_.-]+$/.test(prev) &&
        isCredentialKey(prev.replace(/^-+/, ""));
      if (flagged && typeof item === "string" && !item.startsWith("-") && !onlyReferences(item)) {
        return redacted(prev.replace(/^-+/, ""));
      }
      return mask(item, key, ctx);
    });
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const names = ctx.names || NAME_HOLDER.test(k);
      const sensitive =
        !names &&
        ((ctx.sensitive && !SAFE_CHILD.test(k)) || isCredentialKey(k) || SECRET_MAP.test(k));
      out[k.replace(TOKEN_SHAPES, () => redacted("token"))] = mask(v, k, { names, sensitive });
    }
    return out;
  }
  if (typeof value === "string") return maskString(value, key, ctx);
  if (typeof value === "number" && ctx.sensitive) return redacted(key);
  return value;
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
        i = text.indexOf("*/", i + 2);
        if (i === -1) throw new Error("unterminated comment");
        i++;
      } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  }
}

// ---- TOML -----------------------------------------------------------------------------------

function parseToml(text) {
  const root = {};
  let cur = root;
  let i = 0;
  const fail = (what) => {
    throw new Error(`TOML: ${what} at line ${text.slice(0, i).split("\n").length}`);
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
    if (/^\t/.test(content)) throw new Error(`YAML: tab indentation at line ${n + 1}`);
    lines.push({
      indent: content.length - content.trimStart().length,
      text: content.trim(),
      n: n + 1,
      raw,
    });
  });
  let at = 0;
  const fail = (what) => {
    throw new Error(`YAML: ${what} at line ${lines[at]?.n ?? "end"}`);
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
    if (t.startsWith('"')) return JSON.parse(t.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1"));
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
    const header = /^\s*\[\[?[^\]]+\]\]?\s*$/.exec(line);
    if (header) {
      out.push(line.trimEnd());
      continue;
    }
    const m = /^(\s*(?:-\s+)?)("[^"]*"|'[^']*'|[A-Za-z0-9_.@$\/-]+)\s*([:=])/.exec(line);
    if (m) out.push(`${m[1]}${m[2]}${m[3]} …`);
    else if (/^\s*-/.test(line)) out.push(`${/^\s*/.exec(line)[0]}- …`);
  }
  return out.join("\n");
}

// ---- Scan a folder ---------------------------------------------------------------------------

/**
 * One line of any text file with its credential-looking values masked. `bare`: an unquoted
 * `name = value` counts too, as in YAML, TOML or a shell script; in code a literal is quoted, and
 * an unquoted right-hand side is an expression.
 */
function maskLine(line, bare) {
  const quoted = /(["']?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)(["'])(.*?)\4/g;
  const unquoted = /(["']?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)([^"'\s,}\]\[{]+)/g;
  const keep = (name, value) =>
    !isCredentialKey(name) ||
    value === "" ||
    onlyReferences(value) ||
    masked(value) ||
    /^(true|false|null|\d+)$/.test(value) ||
    // An auth scheme alone: the credential after it is judged on its own.
    /^(bearer|basic|token)$/i.test(value);
  let out = line.replace(quoted, (all, q, name, sep, vq, value) =>
    keep(name, value) ? all : `${q}${name}${q}${sep}${vq}${redacted(name)}${vq}`,
  );
  if (bare) {
    out = out.replace(unquoted, (all, q, name, sep, value) =>
      keep(name, value) ? all : `${q}${name}${q}${sep}${redacted(name)}`,
    );
  }
  return maskInline(out);
}

/** Whether a file's unquoted `name = value` is a literal (config, shell) or an expression (code). */
const bareLiterals = (name) => !/\.(m?[jt]s|cjs|py)$/i.test(name);

function show(files) {
  let status = 0;
  for (const file of files) {
    if (REFUSED.some((re) => re.test(path.basename(file)))) {
      console.log(`# ${file}: a credential store; not read`);
      status = 3;
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (err) {
      console.log(`# ${file}: ${err.code ?? err.message}`);
      status = 1;
      continue;
    }
    if (buf.includes(0)) {
      console.log(`# ${file}: not a text file`);
      continue;
    }
    const bare = bareLiterals(path.basename(file));
    const lines = buf
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => maskLine(line, bare));
    console.log(`# ${file} (masked)\n${lines.join("\n")}`);
  }
  return status;
}

function scan(root) {
  let found = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".git" && entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue;
      const bare = bareLiterals(entry.name);
      buf
        .toString("utf8")
        .split(/\r?\n/)
        .forEach((line, n) => {
          const out = maskLine(line, bare);
          if (out !== line) {
            found++;
            console.log(`${path.relative(root, full)}:${n + 1}: ${out.trim()}`);
          }
        });
    }
  };
  walk(root);
  console.log(
    found === 0
      ? `# ${root}: no credential-looking value`
      : `# ${root}: ${found} line(s) above hold a value: a real one becomes a \${KEY} Vault reference or goes; a placeholder in prose may stay`,
  );
  return found === 0 ? 0 : 1;
}

// ---- Main ------------------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args[0] === "--scan") {
  if (args[1] === undefined) {
    console.error("usage: node inspect-config.mjs --scan <dir>");
    process.exit(2);
  }
  process.exit(scan(args[1]));
}
if (args[0] === "--show") process.exit(show(args.slice(1)));
const files = [];
let only = null;
let keys = false;
for (let a = 0; a < args.length; a++) {
  if (args[a] === "--only") only = (args[++a] ?? "").split(",").filter(Boolean);
  else if (args[a] === "--keys") keys = true;
  else files.push(args[a]);
}
if (files.length === 0) {
  console.error(
    "usage: node inspect-config.mjs <file>... [--only <key>[,<key>...]] [--keys] | --scan <dir> | --show <file>...",
  );
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
  const base = path.basename(file);
  if (REFUSED.some((re) => re.test(base))) {
    console.log(`# ${file}: a credential store; not read`);
    status = 3;
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    console.log(`# ${file}: ${err.code ?? err.message}`);
    status = 1;
    continue;
  }
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
    console.log(
      `# ${file}: not a JSON, TOML or YAML file; read Markdown directly, ask about anything else`,
    );
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
    console.log(
      `# ${file} (${format}): could not be parsed (${err.message}); key names only\n${keysOnly(text)}`,
    );
    status = 1;
    continue;
  }
  if (base === ".claude.json") data = claudeJsonView(data ?? {});
  if (only !== null) data = pick(data ?? {}, only);
  console.log(
    `# ${file} (${format})\n${JSON.stringify(mask(data, "", { names: false, sensitive: false }), null, 2)}`,
  );
}
process.exit(status);

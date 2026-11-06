// The configuration parsers of the agent-porting reader: JSON (comments and trailing commas
// tolerated), TOML and the block subset of YAML that tools' configuration files use. A parse
// error carries the line it happened on and nothing of the file's content, so no caller can
// print a value by printing the error. Built-in modules only.
import path from "node:path";
import { safeKey } from "./detect.mjs";

/** An error that knows the line it happened on, and nothing of the file's content. */
export function parseError(line) {
  const err = new Error("parse");
  err.line = line;
  return err;
}

/** The format a file's name says it has: "json", "toml", "yaml", "markdown" or null. */
export function formatOf(file) {
  const ext = path.extname(path.basename(file)).toLowerCase();
  if (ext === ".toml") return "toml";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".json" || ext === ".jsonc") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return null;
}

export function parseConfig(text, format) {
  return format === "toml"
    ? parseToml(text)
    : format === "yaml"
      ? parseYaml(text)
      : parseJson(text);
}

/**
 * A Markdown file's YAML frontmatter, split from its body: `{ block, body, lines }`, `lines` being
 * how many lines the frontmatter takes with its fences; null when the file has none.
 */
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (m === null) return null;
  return {
    block: m[1],
    body: text.slice(m[0].length),
    lines: m[0].split("\n").length - (m[2] ? 1 : 0),
  };
}

// ---- JSON (with comments) -------------------------------------------------------------------

export function parseJson(text) {
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

export function parseToml(text) {
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

export function parseYaml(text) {
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

export function keysOnly(text) {
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

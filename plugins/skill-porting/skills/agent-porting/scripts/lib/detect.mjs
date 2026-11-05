// What the agent-porting reader treats as a credential, a name or a harmless token. Shared by the
// masked view, `--scan`, `--show` and `--emit`. Built-in modules only.
import { existsSync } from "node:fs";
import path from "node:path";

/** Key and flag names the masked view treats as a credential's (broad on purpose). */
export const CREDENTIAL =
  /key|token|secret|password|passwd|pass|pwd|passphrase|private|auth|credential|cookie|bearer/i;
/** Names the pattern catches that hold a count or a setting, never a credential. */
const NOT_CREDENTIAL = /tokens?_?(limit|budget|count|window)|max_?\w*tokens?$|^tokens$|key_?bind/i;
export const isCredentialKey = (k) => CREDENTIAL.test(k) && !NOT_CREDENTIAL.test(k);

// The server's rule for what an archive blanks (server/src/agent-archive/credential-names.ts),
// which `--emit` follows for `env` and header names: a word of the name is a credential word, or
// ends with one.
const CREDENTIAL_WORDS = new Set([
  "key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "auth",
  "authorization",
  "credential",
  "credentials",
  "cookie",
  "bearer",
  "pat",
]);
const CREDENTIAL_ENDINGS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "key",
  "credential",
  "credentials",
];
const wordsOf = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_.\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
export const isCredentialName = (name) =>
  wordsOf(name).some(
    (w) => CREDENTIAL_WORDS.has(w) || CREDENTIAL_ENDINGS.some((ending) => w.endsWith(ending)),
  ) || isCredentialKey(name);

export const TOKEN_SHAPES =
  /(sk-ant-[\w-]{16,}|sk-[\w-]{16,}|(sk|rk|pk)_(live|test)_[\w]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abposr]-[\w-]{10,}|glpat-[\w-]{16,}|hf_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{16,}|secret_[A-Za-z0-9]{8,}|ntn_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/;
export const PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
export const PEM_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

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
export const isRefused = (file) => REFUSED.some((re) => re.test(path.basename(file)));

/** Code, where an unquoted right-hand side is an expression rather than a literal. */
export const isCode = (name) => /\.(m?[jt]s|cjs|[jt]sx|py)$/i.test(name);

/**
 * A word that is a path to a file this machine actually has: a `/`-rooted or drive-letter absolute
 * path that exists. A path stored in a JSON file (a side file, an emitted wrapper) keeps its
 * backslashes escaped, so the JSON-unescaped form is tried too. A value cannot also be a
 * credential: OS temp paths (`/var/folders/…`, `C:\Users\…\AppData\Local\Temp`) read as
 * high-entropy strings otherwise. Refused names stay refused even at an existing path.
 */
export const isPathOnDisk = (word) => {
  const absolute = (s) =>
    (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s)) && !isRefused(s) && existsSync(s);
  if (absolute(word)) return true;
  if (word.includes("\\\\")) {
    try {
      return absolute(JSON.parse(`"${word}"`));
    } catch {
      return false;
    }
  }
  return false;
};

/** A part that reads as random: letters and digits mixed over 12 characters, or 40 of anything. */
const highEntropy = (part) =>
  (part.length >= 12 && /[0-9]/.test(part) && /[A-Za-z]/.test(part)) || part.length >= 40;
export const tokenish = (s) => TOKEN_SHAPES.test(s) || s.split(/[/.:@~_-]+/).some(highEntropy);

/**
 * A package or path token: short, plain, nothing in it shaped like a token. A `${VAR}` inside
 * (`${CLAUDE_PLUGIN_ROOT}/server.js`) counts as a plain part.
 */
export const pathToken = (s) => {
  const plain = s.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, "VAR");
  return plain.length <= 100 && /^[@\w./:~-]+$/.test(plain) && !tokenish(plain);
};
/** A word that is a path or a package by its shape: it has a `/`, an `@` or a `.`, or starts with `~`. */
export const pathShaped = (s) =>
  (/[/@.]/.test(s) || s.startsWith("~")) && pathToken(s) && lineKind(s, false) === null;

/** A name in the environment-variable convention, the only shape a name position prints. */
export const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
/** DeepSeek Harness writes its `${credential:…}` names in lower case. */
const CREDENTIAL_REF_NAME = /^[a-z_][a-z0-9_.-]{0,63}$/;
export const isEnvName = (s) => ENV_NAME.test(s) && !tokenish(s);

/** A `${…}` reference, with an optional auth scheme in front. */
export const REFERENCE = /^((?:Bearer|Basic|Token) )?\$\{([^{}]*)\}$/i;
/** A reference's parts: the scheme, `credential:` or nothing, the name, and whether it has a default. */
export function referenceParts(s) {
  const m = REFERENCE.exec(s);
  if (m === null) return null;
  const inner = m[2];
  const kind = /^credential:/i.test(inner) ? inner.slice(0, 11) : "";
  const rest = inner.slice(kind.length);
  const cut = rest.indexOf(":-");
  const name = cut === -1 ? rest : rest.slice(0, cut);
  const plain = kind === "" ? isEnvName(name) : CREDENTIAL_REF_NAME.test(name) && !tokenish(name);
  return { scheme: m[1] ?? "", kind, name, plain, fallback: cut !== -1 };
}
/** A reference to a plain variable name, which says nothing about the value behind it. */
export const plainReference = (s) => referenceParts(s)?.plain === true;

/** The flags whose next word is a credential: by name, or the short ones tools use for one. */
export const credentialFlag = (w) =>
  typeof w === "string" &&
  (/^(-u|--user|-p|-P|--pw|--pin)$/.test(w) ||
    (/^--?[A-Za-z][\w.-]*$/.test(w) && isCredentialName(w.replace(/^-+/, ""))));

// ---- Line detectors (best effort: prose has no structure to allowlist) -----------------------

const valueLooksSet = (v) =>
  v !== "" &&
  !plainReference(v) &&
  !/^\$[A-Za-z_]\w*$/.test(v) &&
  !/^(true|false|null|none|~|\d+(\.\d+)?)$/i.test(v) &&
  !/^(bearer|basic|token)$/i.test(v) &&
  !/^[[{(<]/.test(v);

/** A word after "password is" that looks set: long enough, with a digit, a capital or a symbol. */
const phraseValue = (w) =>
  w.length >= 6 &&
  /[0-9A-Z!#$%^&*+=_-]/.test(w) &&
  !/^\$/.test(w) &&
  !/[()]/.test(w) &&
  !/^(process|os|env|import|self|this|window)\./.test(w);

/** A URL path that carries a secret: a webhook's tail, or a segment shaped like a token. */
function secretUrlPath(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/\s?#]*)([^\s?#]*)/i.exec(url);
  if (m === null) return false;
  const segments = m[2].split("/").filter(Boolean);
  if (/hook/i.test(m[1] + m[2]) && segments.some((seg) => seg.length >= 16)) return true;
  return segments.some(
    (seg) => tokenish(seg) || (seg.length >= 16 && /[A-Z]/.test(seg) && /[a-z]/.test(seg)),
  );
}

/**
 * The kind of credential a line carries, or null. `code`: an unquoted right-hand side is an
 * expression (JavaScript, TypeScript, Python), not a literal. Best effort, for prose and scripts;
 * configuration goes through the allowlist instead.
 */
export function lineKind(line, code) {
  if (PEM.test(line)) return "private key block";
  if (TOKEN_SHAPES.test(line)) return "token-shaped string";
  if (/\b[0-9a-f]{32,}\b/i.test(line)) return "hex key";
  if (/[a-z][a-z0-9+.-]*:\/\/[^\s/@:"']+:[^\s/@"']+@/i.test(line)) return "URL user info";
  for (const m of line.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi)) {
    if (secretUrlPath(m[0])) return "URL with a secret in its path";
  }
  for (const m of line.matchAll(/[?&]([^=&\s#"']+)=([^&\s#"']+)/g)) {
    if (isCredentialKey(m[1]) && valueLooksSet(m[2])) return "URL credential parameter";
  }
  if (/(^|[\s"'(])(-u|--user)(\s+|=)["']?[^\s:"']+:[^\s"']+/.test(line)) return "user:password";
  // mysql -p<password>; not -p8080, find's -print / -prune, mkdir -p, a -p <value> pair.
  const attached = /(^|[\s"'])-p(?![\s=]|\d+\b|rint|rune|ath|erm|arents)["']?(?!\$)([^\s"']{4,})/;
  if (attached.test(line)) return "-p password";
  for (const m of line.matchAll(/(^|[\s"'(=])(--?[A-Za-z][\w.-]*)(=|\s+)["']?([^\s"']*)/g)) {
    if (credentialFlag(m[2]) && valueLooksSet(m[4]) && !m[4].startsWith("-")) {
      return "credential flag";
    }
  }
  if (/\bBearer\s+(?!\$)[A-Za-z0-9._~+/=-]{8,}/i.test(line)) return "bearer credential";
  if (/\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}/.test(line)) {
    return "basic credential";
  }
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
  // A password told in words ("the staging password is …"): prose only, after the assignments.
  if (!code) {
    const phrase =
      /\b(password|passphrase|passwd|pwd|secret|token|api[ _-]?key|access[ _-]?key|key)\s*(is|was|:|equals)\s*["'`]?([^\s"'`,;]+)/gi;
    for (const m of line.matchAll(phrase)) {
      if (phraseValue(m[3])) return "credential phrase";
    }
  }
  for (const word of line.split(/[\s"'`,;()<>[\]{}|]+/)) {
    if (
      word.length >= 12 &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(word) &&
      tokenish(word) &&
      !isPathOnDisk(word)
    ) {
      return "high-entropy string";
    }
  }
  return null;
}

/**
 * The lines of a Markdown frontmatter block that hold a value in a credential position: under
 * `env` or `headers`, or under a credential-named key, and not a plain reference. `[line, kind]`,
 * line numbers counted from the block's first line (1).
 */
export function frontmatterHits(block) {
  const hits = [];
  const stack = [];
  block.split(/\r?\n/).forEach((raw, n) => {
    const m = /^(\s*)(?:-\s+)?("[^"]*"|'[^']*'|[^\s:#][^:#]*?)\s*:(?:\s+(.*))?$/.exec(raw);
    if (m === null) return;
    const indent = m[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = m[2].replace(/^["']|["']$/g, "");
    const value = (m[3] ?? "").replace(/\s+#.*$/, "").trim();
    const inSecretMap = stack.some((s) => /^(env|headers|http_headers)$/i.test(s.key));
    if (value === "") {
      stack.push({ indent, key });
      return;
    }
    const plain = value.replace(/^["']|["']$/g, "");
    if ((inSecretMap || isCredentialKey(key)) && !plainReference(plain) && !/^[[{]/.test(plain)) {
      hits.push([n + 1, "credential value in frontmatter"]);
    }
  });
  return hits;
}

/** A text's flagged lines, each replaced whole; a private key block is replaced to its end. */
export function maskLines(text, code) {
  const out = [];
  let inKey = false;
  for (const line of text.split(/\r?\n/)) {
    if (inKey) {
      out.push("<redacted line: private key block>");
      if (PEM_END.test(line)) inKey = false;
      continue;
    }
    const kind = lineKind(line, code);
    if (kind === "private key block" && !PEM_END.test(line)) inKey = true;
    out.push(kind === null ? line : `<redacted line: ${kind}>`);
  }
  return out.join("\n");
}

export const chars = (s) => `<redacted:${s.length} chars>`;
export const safeKey = (k) =>
  tokenish(k) && !k.startsWith("/") ? `<redacted key:${k.length} chars>` : k;

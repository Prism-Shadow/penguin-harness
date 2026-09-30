/**
 * Content redaction for the surfaces that serve raw content back to a reader — a Trace's
 * events, a machine job's log: credential-shaped fields and values are replaced with
 * `[redacted]` on the server, before the answer leaves it.
 *
 * Two rules, both about SHAPE, never about who is asking:
 *   - a field whose NAME is a credential's (it ends in token, secret, password, api key,
 *     authorization, private key, access key) has its string value replaced. Counters that
 *     merely mention tokens — `input_tokens`, `max_tokens`, `tokenCount` — do not end that way
 *     and are left alone;
 *   - inside any string: known token formats, `NAME=value` / `"name": "value"` pairs whose
 *     name is a credential's, `Bearer …`, PEM private-key blocks, and paths to ssh private keys.
 *
 * Best effort by construction: a secret with no recognizable shape passes. The point is that
 * the common ones — an API key echoed by a tool, a token in a command line, a key file path in
 * an ssh log — are not shown to every reader of a Trace.
 */

export const REDACTED = "[redacted]";

/** snake_case / kebab-case / camelCase name → lower snake words. */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s.]+/g, "_")
    .toLowerCase();
}

const CREDENTIAL_NAME =
  /(^|_)(token|secret|password|passwd|passphrase|api_?key|apikey|authorization|private_?key|access_?key|credentials?)$/;

/** Whether a field of this name holds a credential (see the header for what does not count). */
export function isCredentialName(name: string): boolean {
  return CREDENTIAL_NAME.test(words(name));
}

/** Credential-bearing name inside free text, followed by `=` or `:` and a value (quotes optional). */
const NAMED_VALUE =
  /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|passphrase|api[_-]?key|apikey|access[_-]?key|private[_-]?key))(["']?\s*[=:]\s*)(["']?)([^\s"',;&]{3,})\3/gi;

const PATTERNS: Array<[RegExp, string]> = [
  // PEM private keys, whole block.
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, REDACTED],
  // Provider key formats.
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  // Authorization header values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/g, `$1 ${REDACTED}`],
  // ssh private key paths: an IdentityFile line, or a path to ~/.ssh/id_* that is not a .pub.
  [/\b(IdentityFile\s+)\S+/gi, `$1${REDACTED}`],
  [/(?:~|\$HOME|[A-Za-z]:)?[^\s"'`]*[\\/]\.ssh[\\/]id_[A-Za-z0-9_-]+\b(?!\.pub)/g, REDACTED],
];

/** Redacts the credential shapes inside one string. */
export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out.replace(NAMED_VALUE, (_m, name: string, sep: string, quote: string) => {
    return `${name}${sep}${quote}${REDACTED}${quote}`;
  });
}

/**
 * Redacts a JSON-shaped value: strings by redactText, and the value of every field whose name
 * is a credential's. Returns a copy; the input is not touched.
 */
export function redactValue<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = typeof v === "string" && v !== "" && isCredentialName(key) ? REDACTED : walk(v);
    }
    return out;
  }
  return value;
}

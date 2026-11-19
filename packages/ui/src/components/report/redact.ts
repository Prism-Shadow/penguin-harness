/**
 * Takes what looks like a secret out of a text the person is about to share — a provider's error
 * message, an exception's stack, on its way into a bug report — and puts `[redacted]` in its
 * place; and takes the person's name out of the home directories a stack's paths run through.
 *
 * A provider sometimes echoes what it was sent: a key it refused (whole, or masked with a few
 * characters left), the request's Authorization header, a URL with credentials or a key in its
 * query. So the rules go by shape, not by provider:
 *
 * - a value named as a secret — `api_key=…`, `"token": "…"`, `Authorization: Bearer …` — in a
 *   query string, a header or a JSON body;
 * - a bearer or basic credential wherever it stands;
 * - the well-known key prefixes (`sk-`, `AIza`, `ghp_`, `github_pat_`, `xai-`, `gsk_`, `hf_`),
 *   masked ones included;
 * - a URL's user and password;
 * - a UUID (some providers' keys are one);
 * - a long random token: 32 characters or more of letters, digits and `-_+=`, with both letters
 *   and digits and a run of 16 or more between its dashes — which leaves a model id or a
 *   hyphenated word alone.
 *
 * `keep` names strings that look random but are safe to share and useful to whoever reads the
 * report (the provider's request id). Erring on the side of removing: a removed hash costs a
 * reader a detail, a kept key costs the person their account.
 *
 * A home directory (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`) keeps its shape and
 * loses its name (`/home/<user>/…`), so a stack still says where a file sits without saying whose
 * machine it was.
 *
 * `maskPrivate` is the one step every report's text goes through: all of the above, the values the
 * caller knows are private, the paths it names (`<workspace>`), e-mail addresses (`<email>`) and
 * IPv4 addresses other than loopback (`<ip>`) — and, for a text that names the person's machines
 * (ssh's words, an MCP server's error), host names, IPv6 addresses and `user@host` too.
 */

export const REDACTED = "[redacted]";

/** Names whose value is a secret, wherever they are spelled with `=` or `:`. */
const SECRET_NAMES =
  "api[_-]?key|apikey|x-api-key|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|secret[_-]?key|secret|password|passwd|authorization|token|key|signature|sig";

/** `name=value`, `name: value`, `"name":"value"`; a scheme word before the value goes with it. */
const NAMED = new RegExp(
  `(["']?)\\b(${SECRET_NAMES})\\1(\\s*[:=]\\s*)(["']?)((?:(?:Bearer|Basic)\\s+)?[^"'\\s,;&)}\\]]+)`,
  "gi",
);

/** A bearer token wherever it stands; a basic credential only with a digit or padding, not a word. */
const BEARER = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{8,})/g;

const KEY_PREFIXES =
  /\b(?:sk[-_][A-Za-z0-9_*-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xai-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,})/g;

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const TOKEN_RUN = /[A-Za-z0-9_+=-]{32,}/g;

/** A run that reads as random: letters and digits both, and one stretch of 16+ between dashes. */
function looksRandom(run: string): boolean {
  return (
    /[A-Za-z]/.test(run) && /\d/.test(run) && run.split(/[-_]/).some((part) => part.length >= 16)
  );
}

export function redactSecrets(text: string, keep: readonly string[] = []): string {
  const kept = new Set(keep.filter((value) => value.length > 0));
  const unlessKept = (match: string) => (kept.has(match) ? match : REDACTED);
  return text
    .replace(
      NAMED,
      (whole, quote: string, name: string, sep: string, open: string, value: string) =>
        kept.has(value) || value === REDACTED
          ? whole
          : `${quote}${name}${quote}${sep}${open}${REDACTED}`,
    )
    .replace(BEARER, (whole, scheme: string, value: string) =>
      scheme === "Basic" && !/[\d=]/.test(value) ? whole : `${scheme} ${REDACTED}`,
    )
    .replace(KEY_PREFIXES, unlessKept)
    .replace(URL_CREDENTIALS, (_, scheme: string) => `${scheme}${REDACTED}@`)
    .replace(UUID, unlessKept)
    .replace(TOKEN_RUN, (run) => (kept.has(run) || !looksRandom(run) ? run : REDACTED));
}

/** The account names in home-directory paths: macOS, Linux, Windows (either slash). */
const HOME_PATHS = /(\/Users\/|\/home\/|[A-Za-z]:[\\/]+Users[\\/]+)([^\\/\s:"'`<>|]+)/g;

export function redactHomePaths(text: string): string {
  return text.replace(HOME_PATHS, (_, root: string) => `${root}<user>`);
}

/** Where a report's text may name the person's own things, and what to take out of it. */
export interface MaskOptions {
  /** Strings that look random but are safe to share (a provider's request id). */
  keep?: readonly string[];
  /** Paths to replace with `<workspace>` (the Workspace, a browsed folder). */
  privatePaths?: readonly string[];
  /** Values the caller knows are private (a machine's alias), each replaced with `[redacted]`. */
  values?: readonly string[];
  /**
   * The text can name the person's machines — ssh's words, an MCP server's error: host names,
   * IPv6 addresses and `user@host` are masked as well.
   */
  hosts?: boolean;
}

const EMAIL = /\b[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}\b/g;

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?![\\w.])`, "g");

/** Loopback and "any" say nothing about whose machine it was, and tell a reader a lot. */
const KEPT_IPV4 = /^(?:127\.|0\.0\.0\.0$)/;

const IPV6 =
  /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?)(?![\w:])/gi;

/** `user@host`, as ssh names its destination; a package's `name@1.2.3` is left alone. */
const USER_AT_HOST = /(?<![\w.@-])[\w.-]+@([\w-]+(?:\.[\w-]+)*)/g;
const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/**
 * A host name: dotted labels ending in one of letters. Inside a path it is a directory or a file,
 * not a host, so one after a single slash is left alone (a URL's, after `//`, is not), and so is
 * a file name, by its extension (`index.js`).
 */
const HOST_NAME =
  /(?<![\w.\\-])(?<![^/]\/)(?<!^\/)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})(?![\w-])/gim;
const FILE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "md",
  "txt",
  "log",
  "yaml",
  "yml",
  "toml",
  "lock",
  "map",
  "html",
  "css",
  "py",
  "sh",
  "exe",
  "dll",
  "so",
  "dylib",
  "node",
  "pem",
  "pub",
]);

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function maskPrivate(text: string, options: MaskOptions = {}): string {
  let out = redactSecrets(text, options.keep ?? []);
  for (const path of options.privatePaths ?? []) {
    if (path !== "") out = out.split(path).join("<workspace>");
  }
  out = redactHomePaths(out).replace(EMAIL, "<email>");
  if (options.hosts === true) {
    out = out
      .replace(USER_AT_HOST, (whole, host: string) => (SEMVER.test(host) ? whole : "<user>@<host>"))
      .replace(IPV6, "<ip>");
  }
  out = out.replace(IPV4, (ip) => (KEPT_IPV4.test(ip) ? ip : "<ip>"));
  if (options.hosts === true) {
    out = out.replace(HOST_NAME, (host, tld: string) =>
      FILE_EXTENSIONS.has(tld.toLowerCase()) || host.toLowerCase() === "localhost"
        ? host
        : "<host>",
    );
  }
  // Last, so a known alias inside a host name does not leave the rest of the name behind; longest
  // first, so a value inside another is not masked in part. Too short a value would mask words.
  const values = [...(options.values ?? [])].filter((value) => value.length >= 3);
  values.sort((a, b) => b.length - a.length);
  for (const value of values) {
    out = out.replace(new RegExp(`(?<![\\w-])${escaped(value)}(?![\\w-])`, "g"), REDACTED);
  }
  return out;
}

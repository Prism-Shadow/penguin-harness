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

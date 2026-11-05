/**
 * Whether a name — an MCP `env` or header name, a query parameter, a command-line flag, an
 * OAuth field, a vault key — names a credential, as far as an Agent archive is concerned.
 *
 * A name is split into its words (on `-`, `_`, `.`, spaces and lower-to-upper case changes, so
 * `GITHUB_TOKEN`, `apiKey`, `x-api-key` and `clientSecret` all split) and is a credential's when
 * one word, in any letter case, is one of the words below. A word that only contains one of them
 * is not enough: `max-tokens`, `MAX_TOKENS`, `keyword`, `tokenizer` and `author` are ordinary
 * settings. The rule errs on the side of blanking where a name does say so.
 */

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

/** The words of a name, lower-cased. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_.\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

export function isCredentialName(name: string): boolean {
  return wordsOf(name).some((word) => CREDENTIAL_WORDS.has(word));
}

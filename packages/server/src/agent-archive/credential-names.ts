/**
 * Whether a name — an MCP `env` or header name, a query parameter, a command-line flag, an
 * OAuth field, a vault key — names a credential, as far as an Agent archive is concerned.
 *
 * A name is split into its words (on `-`, `_`, `.`, spaces and lower-to-upper case changes, so
 * `GITHUB_TOKEN`, `apiKey`, `x-api-key` and `clientSecret` all split) and is a credential's when
 * one word, in any letter case, is one of `CREDENTIAL_WORDS` or ends with one of
 * `CREDENTIAL_ENDINGS`. The words catch the short forms (`DB_PASS`, `SMTP_PW`, `JWT`,
 * `SENTRY_DSN`); the endings catch names written as one word: `PGPASSWORD`, the `authtoken` of
 * `NGROK_AUTHTOKEN`, `secretkey`, `accesstoken`, `privatekey`, `dbpass`.
 *
 * A word that only starts with or contains one is not enough: `max-tokens`, `tokens`, `keyword`,
 * `tokenizer`, `author`, `keyboard` and `keystore` are ordinary settings (a keystore's name is a
 * path; its password goes by `KEYSTORE_PASSWORD`, which counts). The rule errs on the side of
 * blanking: a value blanked by mistake (a `hotkey` or a `bypass`, say) costs one entry to fill in
 * after the import, a credential missed travels with the zip.
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
  "pass",
  "pw",
  "jwt",
  "dsn",
]);

/** A word ending in one of these is a credential's too. */
const CREDENTIAL_ENDINGS = [
  "password",
  "passwd",
  "pwd",
  "pass",
  "token",
  "secret",
  "key",
  "credential",
  "credentials",
];

/** The words of a name, lower-cased. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_.\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

const isCredentialWord = (word: string): boolean =>
  CREDENTIAL_WORDS.has(word) || CREDENTIAL_ENDINGS.some((ending) => word.endsWith(ending));

export function isCredentialName(name: string): boolean {
  return wordsOf(name).some(isCredentialWord);
}

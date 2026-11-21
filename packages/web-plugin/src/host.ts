/**
 * `@prismshadow/penguin-web-plugin/host` — the Web App's side of the face, and nobody else's:
 * handing over its implementations, telling the face the language on screen, and reading the
 * error-code words plugins brought.
 */
export { provideWebHost } from "./bridge";
export type { WebHost } from "./bridge";
export { contributedErrorText, setWebLocale } from "./strings";

/**
 * `@prismshadow/penguin-server/model-catalog`: the built-in model catalog, browser-safe, for the
 * Web App, the CLI and the component gallery. One concern per module, imported in one direction
 * (no cycle, so no binding is read before its module has run):
 *
 *   client-protocols.ts  MMSP's routing (passed through) and the path and fast-mode protocol
 *                        per client; imports only MMSP's credentials module
 *   catalog.ts           the data and lookups; imports MMSP's credentials module
 *   env-keys.ts          the variables a model reads and its client's default endpoint, asked
 *                        of MMSP; imports catalog.ts
 *   seed.ts              the Project seed; imports catalog.ts
 *
 * The environment-key rule and the routing are MMSP's (`@prismshadow/mmsp/credentials`); no
 * module keeps a copy of either. No module imports a Node built-in. Server code may import the
 * module it needs directly.
 */
export * from "./catalog.js";
export * from "./client-protocols.js";
export * from "./env-keys.js";
export * from "./seed.js";

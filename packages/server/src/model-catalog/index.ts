/**
 * `@prismshadow/penguin-server/model-catalog`: the built-in model catalog, browser-safe, for the
 * Web App, the CLI and the component gallery. One concern per module, imported in one direction
 * (no cycle, so no binding is read before its module has run):
 *
 *   routing.ts   MMSP's routing mirror; imports only core's model-connection subpath
 *   catalog.ts   the data and lookups; imports routing.ts
 *   env-keys.ts  the variable a keyless row reads, for the previews; imports catalog, routing
 *   seed.ts      the Project seed; imports catalog.ts
 *
 * No module imports a Node built-in. Server code may import the module it needs directly.
 */
export * from "./catalog.js";
export * from "./env-keys.js";
export * from "./routing.js";
export * from "./seed.js";

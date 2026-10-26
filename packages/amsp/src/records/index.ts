/**
 * AMSP records — the envelope `{timestamp, type, payload, origin?}`, every payload, the guards
 * over them, and the builders every producer writes records through. A Trace line is one record,
 * and so is every unnamed event of a Session stream.
 *
 * Also the package's `@prismshadow/amsp/records` entry; the root re-exports all of it.
 * Docs: /docs/amsp-records.
 */
export * from "./types.js";
export * from "./builders.js";
export * from "./task-records.js";
export * from "./source.js";

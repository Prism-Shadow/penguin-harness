/**
 * @prismshadow/amsp — public entry point: the AMSP wire types, which the PenguinHarness server
 * imports as types too, and a zero-dependency client of one Agent's API.
 */
export * from "./types.js";
export { AmspHttpError, AmspStreamError } from "./errors.js";
export { AgentClient } from "./client.js";
export type { AgentClientOptions, Run, RunOptions } from "./client.js";
export { parseArguments } from "./collect.js";
export type { RunResult } from "./collect.js";
export { readSse } from "./sse.js";

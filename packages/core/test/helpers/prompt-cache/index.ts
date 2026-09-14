/**
 * The prompt-cache test helpers, in the order a reader meets them.
 *
 *   - `recording.ts` drives a real model over a scripted provider stream and captures every
 *     request in the shape the client would have put on the wire.
 *   - `diagnostics.ts` takes two consecutive recordings and names the earliest point at which
 *     the second stopped being an extension of the first.
 *   - `simulator.ts` runs the recordings through Anthropic's cache rules and answers what a
 *     provider would actually have read back, in the numbers a provider reports.
 *   - `fixtures.ts` holds the agent, the fake collaborators and the assertion the Session
 *     suites share.
 *
 * Three suites import from here: `prompt-cache-invariants.test.ts` (the harness's assembly
 * invariants), `prompt-cache-simulator.test.ts` (the simulator's own rules) and
 * `prompt-cache-lifecycle.test.ts` (the whole Session lifecycle, measured through the simulator).
 */
export * from "./recording.js";
export * from "./diagnostics.js";
export * from "./simulator.js";
export * from "./fixtures.js";

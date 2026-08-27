/**
 * Internal SDK interface contracts, split by which side of `context_engine` needs them:
 * `./llm.ts` (the model request), `./environment.ts` (tool execution and the environment's
 * management plane), and `./shared.ts` (the vocabulary both genuinely need). This barrel is
 * the published `@prismshadow/penguin-core/interfaces` entry and re-exports all three, so
 * every existing import path keeps working.
 *
 * `context_engine` only handles OmniMessage: the content crossing all three boundaries is
 * OmniMessage and nothing else. What crosses alongside it is the **control plane** —
 * `signal`, `thinkingLevel`, the `approve` callback, and the LLM's `LLMOutcome` return
 * value — deliberately not message-shaped, because none of it is conversation content.
 * Protocol conversion and concrete implementations are each interface's own responsibility.
 *
 * Human is not an "interface/class with methods" but the SDK's input/output boundary itself:
 * output is streamed by `Session.run()` as an async generator, and input is delivered via
 * `run`'s `RunOptions` — approvals are requested one at a time through the injected `approve`
 * callback, and interruption goes through `signal`. Hence no Human interface is defined here.
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces) explains each
 * contract and its extension seams — keep the page in sync when changing signatures here.
 */
export type * from "./shared.js";
export type * from "./llm.js";
export * from "./environment.js";

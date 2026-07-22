/**
 * @prismshadow/penguin-core — public entry point for the PenguinHarness core SDK.
 *
 * Exports the OmniMessage protocol, the three interface contracts (Human/LLM/Environment),
 * and the runtime entry points for Agent / Session / context_engine along with their
 * submodules (state / llm / environment / trace).
 *
 * Typical usage:
 *
 * ```ts
 * const agent = await createAgent({ agentId: "default_agent" });
 * // A model reference is always the (provider, model_id) pair; omit both for the Project default.
 * const session = await agent.createSession({ workspaceDir, provider, modelId });
 * for await (const output of session.run([userText("...")])) { ... }
 * ```
 */

// Protocol and interface contracts (foundation)
export * from "./omnimessage/index.js";
export * from "./interfaces.js";

// Only the default server port leaves internal: the CLI / server default-port source of truth.
export { DEFAULT_SERVER_PORT } from "./internal/ports.js";

// Submodules
export * from "./state/index.js";
export * from "./llm/index.js";
export * from "./environment/index.js";
export * from "./trace/index.js";

// Runtime entry points
export { ContextEngine } from "./engine/context-engine.js";
export type {
  CompactAvailability,
  CompactionSettings,
  ContextEngineDeps,
  EngineInitialState,
  RunOptions,
  TraceSink,
} from "./engine/context-engine.js";
export { Session } from "./session.js";
export type { SessionConfig } from "./session.js";
// Session-title generation lives in internal/ (an assembly detail of Session.generateTitle);
// only its narrow public surface is re-exported: the result type (part of
// Session.generateTitle's signature) and the sanitation helpers the Web server's title
// fallback builds on (stripConversationMarkers / sanitizeTitle). The prompt/request
// internals (buildTitlePrompt / generateTitleWithLLM) are deliberately not public.
export { sanitizeTitle, stripConversationMarkers } from "./internal/session-title.js";
export type { SessionTitleResult } from "./internal/session-title.js";
export { Agent, createAgent } from "./agent.js";
export type { CreateAgentOptions, CreateSessionOptions, ResumeSessionOptions } from "./agent.js";

/** SDK version number. */
export const VERSION = "0.1.0";

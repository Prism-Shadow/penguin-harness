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
export {
  buildTitlePrompt,
  generateTitleWithLLM,
  sanitizeTitle,
  stripConversationMarkers,
} from "./session-title.js";
export type { SessionTitleResult } from "./session-title.js";
export { Agent, createAgent } from "./agent.js";
export type { CreateAgentOptions, CreateSessionOptions, ResumeSessionOptions } from "./agent.js";

/** SDK version number. */
export const VERSION = "0.1.0";

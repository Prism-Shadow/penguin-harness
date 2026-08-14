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
export * from "./goal/index.js";

// Runtime entry points
export { ContextEngine, reconnectDelayMs } from "./engine/context-engine.js";
export type {
  CompactAvailability,
  CompactionSettings,
  ContextEngineDeps,
  EngineInitialState,
  RunOptions,
  TraceSink,
} from "./engine/context-engine.js";
export { Session } from "./session.js";
export type { GoalRunOptions, SessionConfig, SessionRunOptions } from "./session.js";
// Session-title generation lives in internal/ (an assembly detail of Session.generateTitle);
// only its narrow public surface is re-exported: the result type (part of
// Session.generateTitle's signature) and sanitizeTitle. The prompt/request internals
// (buildTitlePrompt / generateTitleWithLLM) are deliberately not public; marker stripping
// (stripConversationMarkers) is exported from the markers module via the omnimessage barrel.
export { sanitizeTitle } from "./internal/session-title.js";
export type { SessionTitleResult } from "./internal/session-title.js";
// Session assembly likewise stays internal; only the attachment-line placement rule is
// re-exported, because the server appends `[attached file: …]` lines for the composer's
// uploads and both producers must place them identically (see the markers module).
export { appendAttachmentLines } from "./internal/session-support.js";
// Model-visible path spelling (forward slashes on Windows); the server uses it for its
// [attached file: ...] lines so every path the model reads has one spelling per platform.
export { modelVisiblePath } from "./internal/model-visible-path.js";
export { Agent, createAgent } from "./agent.js";
export type { CreateAgentOptions, CreateSessionOptions, ResumeSessionOptions } from "./agent.js";

/** SDK version number. */
export const VERSION = "0.2.2";
/** Release build date (UTC yyyy-mm-dd), stamped by the release workflow next to VERSION; null in a dev/source build. */
export const BUILD_DATE: string | null = null;
// Version-string helpers (shared by the CLI's `penguin update` and the server's update check).
export { compareVersions, normalizeVersion } from "./internal/version.js";

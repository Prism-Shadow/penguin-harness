/**
 * The platform internals the parked plugin groups compile against, one surface: each
 * functional group under plugins/ consumes the host through this subpath while it is
 * parked there (`@prismshadow/penguin-server/internal`), so the group's imports name one
 * seam instead of reaching into the host's file tree. What the host publishes as its own
 * subpaths (./api, ./plugin, …) stays on those.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults. A module the
 * groups no longer need leaves this list; a module two groups need joins it.
 */
export * from "./auth/middleware.js";
export * from "./auth/service.js";
export * from "./db/repos/organizations.js";
export * from "./db/repos/sessions.js";
export * from "./hmr/asset-archives.js";
export * from "./hmr/capabilities.js";
export * from "./http/errors.js";
export * from "./http/routes/events.js";
export * from "./http/validate.js";
export * from "./mechanisms/agents.js";
export * from "./mechanisms/identity.js";
export * from "./mechanisms/messaging.js";
export * from "./mechanisms/observability.js";
export * from "./mechanisms/organization.js";
export * from "./mechanisms/projects.js";
export * from "./mechanisms/sessions.js";
export * from "./mechanisms/settings.js";
export * from "./runtime/channel.js";
export * from "./runtime/error-recorder.js";
export * from "./runtime/messaging/enabled-channel.js";
export * from "./runtime/session-manager.js";
export * from "./services/ids.js";
export * from "./services/project-config-service.js";
export * from "./services/semantic-id.js";
export * from "./services/semantic-id-suggest.js";
export * from "./mechanisms/workspace.js";
export * from "./db/repos/browser-extensions.js";
export * from "./db/repos/errors.js";
export * from "./db/repos/schedules.js";
export * from "./db/repos/server-settings.js";
export * from "./db/repos/trace-index.js";
export * from "./db/repos/usage.js";
export * from "./hmr/manifest.js";
export * from "./hmr/pushed-build.js";
export * from "./install-id.js";
export * from "./internal/dates.js";
export * from "./internal/mtime-gate.js";
export * from "./internal/trace-head.js";
export * from "./machines/layout.js";
export * from "./mechanisms/traces.js";
export * from "./services/desktop-update-port.js";
export * from "./services/protocol-detect.js";
export * from "./services/skill-import-limits.js";
export * from "./runtime/session-sources.js";
export * from "./runtime/title-generator.js";
export * from "./validate.js";
export * from "./errors.js";
export type { Machines } from "./machines/service.js";
export type { ServerConfig } from "./config.js";
export type { ServerHmrHost } from "./hmr/platform.js";

/**
 * The web app's internals the domain packages' web halves compile against, one surface: each
 * domain's web half under library/ consumes the web host through this subpath
 * (`@prismshadow/penguin-web/internal`), so its imports name one seam instead of reaching into
 * the host's file tree.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */
export * from "./api/client";
export * from "./api/endpoints";
export * from "./api/tool-types";
export * from "./lib/agent-plugin-install";
export * from "./lib/api-error";
export * from "./lib/app-center-path";
export * from "./lib/card-open";
export * from "./lib/default-models-request";
export * from "./lib/desktop-renderer";
export * from "./lib/failure";
export * from "./lib/first-workbench-entry";
export * from "./lib/first-workbench-tour";
export * from "./lib/format";
export * from "./lib/local-first";
export * from "./lib/model-group-order";
export * from "./lib/model-grouping";
export * from "./lib/model-onboarding";
export * from "./lib/model-tags";
export * from "./lib/page-agent";
export * from "./lib/page-layout";
export * from "./lib/page-workspace";
export * from "./lib/protocol-client-types";
export * from "./lib/session-app-dock";
export * from "./lib/session-machines";
export * from "./lib/sidebar-contributions";
export * from "./lib/strings";
export * from "./lib/system-app-notes";
export * from "./lib/toast-api-error";
export * from "./lib/tone";
export * from "./lib/use-document-title";
export * from "./lib/use-update-badges";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/project";
export * from "./state/sessions";
export * from "./state/theme";
export * from "./state/use-tool-bindings";
export * from "./features/ai-create";
export * from "./features/chat";
export * from "./features/todos";

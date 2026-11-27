/**
 * The web app's internals the domain packages' web halves compile against, one surface: each
 * domain's web half under library/ consumes the web host through this subpath
 * (`@prismshadow/penguin-web/internal`), so its imports name one seam instead of reaching into
 * the host's file tree.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults. A feature that still
 * lives under `src/features/` is not re-exported here — a library file may not import a feature
 * (the module-boundaries ratchet) — those halves import such a feature through its face,
 * `@prismshadow/penguin-web/features/<feature>`.
 */
export * from "./api/client";
export * from "./api/endpoints";
export * from "./api/sse";
export * as api from "./api/endpoints";
// `api/endpoints` and `state/machines` both star-export a `useMachines`; a star re-export of an
// ambiguous name is dropped, so the seam names the one the halves consume (the store hook).
export { useMachines } from "./state/machines";
// The server-hosted values a web half consumes at runtime; the libraries carry no server
// dependency, so the type-only imports stay on `@prismshadow/penguin-server/api` (erased by the
// build) and these constants ride the seam.
export { TICKET_SLUG_PATTERN, ticketCreatedDate } from "@prismshadow/penguin-server/ticket-id";
export * from "./components/ui/avatar-picker";
export * from "./components/ui/group-list";
export * from "./components/ui/session-row-menu";
export * from "./components/ui/truncated";
export * from "./lib/account-sync/cache";
export * from "./lib/agent-avatar";
export * from "./lib/agent-deletion-progress";
export * from "./lib/agent-employment";
export * from "./lib/agent-location";
export * from "./lib/api-error";
export * from "./lib/app-center-path";
export * from "./lib/canvas-view";
export * from "./lib/app-window-address";
export * from "./lib/archive-download";
export * from "./lib/builtin-agents";
export * from "./lib/bulk-update";
export * from "./lib/catalog-storage";
export * from "./lib/category-colors";
export * from "./lib/clipboard";
export * from "./lib/company-context";
export * from "./lib/company-nav";
export * from "./lib/failure";
export * from "./lib/first-workbench-entry";
export * from "./lib/format";
export * from "./lib/frame-address";
export * from "./lib/frame-context";
export * from "./lib/frame-location";
export * from "./lib/frame-messages";
export * from "./lib/host-history";
export * from "./lib/machine-catalogs";
export * from "./lib/model-grouping";
export * from "./lib/nav-icons";
export * from "./lib/page-frame";
export * from "./lib/page-slot";
export * from "./lib/page-workspace";
export * from "./lib/page-workspace-context";
export * from "./lib/palette-actions";
export * from "./lib/project-scope";
export * from "./lib/read-store";
export * from "./lib/running-apps";
export * from "./lib/semantic-id";
export * from "./lib/session-activity";
export * from "./lib/session-app-dock";
export * from "./lib/session-workbenches";
export * from "./lib/shortcuts/use-keymap";
export * from "./lib/sidebar-contributions";
export * from "./lib/skill-use";
export * from "./lib/stat-icons";
export * from "./lib/strings";
export * from "./lib/system-app-notes";
export * from "./lib/system-apps";
export * from "./lib/textarea-fit";
export * from "./lib/tone";
export * from "./lib/toast-api-error";
export * from "./lib/use-document-title";
export * from "./lib/web-app-pages";
export * from "./lib/work-mode";
export * from "./lib/workbench-shortcut";
export * from "./lib/workbench-tabs";
export * from "./lib/workbench-theme";
export * from "./rescue/safe-mode";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/machines";
export * from "./state/project";
export * from "./state/sessions";
export * from "./state/theme";
export * from "./state/user-events";

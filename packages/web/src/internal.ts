/**
 * The web app's internals the parked plugin groups compile against, one surface: each
 * functional group under plugins/ consumes the web host through this subpath while it is
 * parked there (`@prismshadow/penguin-web/internal`), so the group's imports name one
 * seam instead of reaching into the host's file tree.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */
export * from "./api/client";
export * from "./api/endpoints";
export * from "./components/ui/avatar-crop-dialog";
export * from "./components/ui/group-list";
export * from "./components/ui/session-row-menu";
export * from "./components/ui/truncated";
export * from "./features/chat/index";
export * from "./features/messaging/index";
export * from "./features/model-picker/index";
export * from "./features/models/index";
export * from "./features/plugins/index";
export * from "./features/semantic-id/index";
export * from "./features/skills/index";
export * from "./features/traces/index";
export * from "./features/usage/index";
export * from "./features/workspace/index";
export * from "./features/workspace/workspace-browser";
export * from "./lib/api-error";
export * from "./lib/avatar-image";
export * from "./lib/category-colors";
export * from "./lib/clipboard";
export * from "./lib/company-context";
export * from "./lib/company-nav";
export * from "./lib/format";
export * from "./lib/nav-icons";
export * from "./lib/semantic-id";
export * from "./lib/session-activity";
export * from "./lib/sidebar-contributions";
export * from "./lib/stat-icons";
export * from "./lib/strings";
export * from "./lib/textarea-fit";
export * from "./lib/tone";
export * from "./lib/use-document-title";
export * from "./lib/web-app-pages";
export * from "./lib/work-mode";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/project";
export * from "./state/sessions";
export * from "./state/theme";
export * from "./state/user-events";

/**
 * The web app's internals the parked plugin groups compile against, one surface: each
 * functional group under plugins/ consumes the web host through this subpath while it is
 * parked there (`@prismshadow/penguin-web/internal`), so the group's imports name one
 * seam instead of reaching into the host's file tree.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */
export * from "./api/client";
export * from "./api/session-probe";
export * from "./api/endpoints";
export * from "./components/ui/avatar-crop-dialog";
export * from "./components/ui/group-list";
export * from "./components/ui/session-row-menu";
export * from "./components/ui/truncated";
export * from "./features/agents/index";
export * from "./features/ai-create/index";
export * from "./features/dock/index";
export * from "./features/chat/index";
export * from "./features/messaging/index";
export * from "./features/model-picker/index";
export * from "./features/models/index";
export * from "./features/plugins/index";
export * from "./features/settings/index";
export * from "./features/semantic-id/index";
export * from "./features/skills/index";
export * from "@penguinharness/plugin-usage/web";
export * from "@penguinharness/plugin-projects/web";
export * from "./lib/api-error";
export * from "./lib/browser-start-sites";
export * from "./lib/settings-request";
export * from "./lib/chat-session";
export * from "./lib/dock-panel-empty";
export * from "./lib/file-path";
export * from "./lib/reader-find";
export * from "./lib/session-row-contributions";
export * from "./lib/notice-dismissals";
export * from "./state/machines";
export * from "./lib/shortcuts/use-keymap";
export * from "./lib/workbench-tabs";
export * from "./lib/workbench-theme";
export * from "./rescue/palette";
export * from "./lib/workspace-tree";
export * from "./components/ui/stat-hint";
export * from "./lib/benchmark-merge";
export * from "./lib/card-open";
export * from "./lib/context";
export * from "./lib/rsi-methods";
export * from "./lib/stop-reason-tone";
export * from "./lib/todo-dismissals";
export * from "./lib/usage-controls";
export * from "./lib/use-project-todos";
export * from "./lib/use-rsi-toolkits";
export * from "./lib/use-update-badges";
export * from "./lib/workspace-machines";
export * from "./lib/avatar-image";
export * from "./lib/category-colors";
export * from "./lib/clipboard";
export * from "./features/dock/dock-state";
export * from "./lib/company-context";
export * from "./lib/company-nav";
export * from "./lib/format";
export * from "./lib/nav-icons";
export * from "./lib/semantic-id";
export * from "./lib/session-activity";
export * from "./lib/sidebar-contributions";
export * from "./lib/stat-icons";
export * from "./lib/server-context";
export * from "./lib/shortcuts/platform";
export * from "./lib/shortcuts/store";
export * from "./lib/shortcuts/terminal-clipboard";
export * from "./lib/shortcuts/terminal-keys";
export * from "./lib/strings";
export * from "./lib/terminal-machines";
export * from "./lib/textarea-fit";
export * from "./lib/tone";
export * from "./lib/use-coarse-pointer";
export * from "./lib/use-document-title";
export * from "./lib/use-visual-viewport-height";
export * from "./lib/web-app-pages";
export * from "./lib/work-mode";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/project";
export * from "./state/sessions";
export * from "./state/theme";
export * from "./state/user-events";


/** useMachines: the machines account state wins over the api/endpoints hook of the same name. */
export { useMachines } from "./state/machines";
export { useMachines as useMachinesApi } from "./api/endpoints";
export * from "./lib/instant-setting";
export * from "./api/workspace-files";
export * from "./lib/account-menu";
export * from "./lib/shortcuts/match";
export * from "./lib/file-drop";
export * from "./lib/desktop-renderer";
export * from "./lib/reply-link";
export * from "./api/sse";
export * from "./lib/session-grouping";
export * from "./lib/upload-limits";
export * from "./components/ui/text-selection";
export * from "./lib/attachments";


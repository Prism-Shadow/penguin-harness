/**
 * The web app's internals the domain web halves compile against, one surface: a web half moved
 * into a library package (its package's `./web` entry, compiled by this package's program)
 * consumes the host through this subpath (`@prismshadow/penguin-web/internal`), so its imports
 * name one seam instead of reaching into the host's file tree.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults. Two kinds of member:
 * the host files the web halves read, and the pieces of those web halves the host reads back
 * (the faces' index exports, named one by one so a star collision can never drop one silently).
 */
export * from "./api/client";
export * from "./api/endpoints";
export * from "./components/account/change-password-dialog";
export * from "./components/ui/avatar-picker";
export * from "./components/ui/chord-kbd";
export * from "./components/ui/truncated";
export * from "./features/admin";
export * from "./features/agents";
export * from "./features/ai-create";
export * from "./features/chat";
export * from "./features/dock";
export * from "./features/machines";
export * from "./features/model-picker";
export * from "./features/semantic-id";
export * from "./features/skills";
export * from "./features/todos";
export * from "./lib/account-menu";
export * from "./lib/account-sync/theme-packs";
export * from "./lib/agent-avatar";
export * from "./lib/agent-location";
export * from "./lib/agent-plugin-install";
export * from "./lib/amsp/user-events";
export * from "./lib/api-error";
export * from "./lib/app-center-path";
export * from "./lib/archive-download";
export * from "./lib/brand-logo";
export * from "./lib/builtin-agents";
export * from "./lib/card-open";
export * from "./lib/catalog-storage";
export * from "./lib/category-colors";
export * from "./lib/chat-session";
export * from "./lib/company-context";
export * from "./lib/dock-panel-empty";
export * from "./lib/failure";
export * from "./lib/file-path";
export * from "./lib/first-workbench-entry";
export * from "./lib/format";
export * from "./lib/instant-setting";
export * from "./lib/machine-agent-lists";
export * from "./lib/machine-cache";
export * from "./lib/machine-catalogs";
export * from "./lib/machine-link";
export * from "./lib/module-gate";
export * from "./lib/nav-icons";
export * from "./lib/notification-pref";
export * from "./lib/page-agent";
export * from "./lib/plugin-config-event";
export * from "./lib/plugin-modules";
export * from "./lib/project-change-events";
export * from "./lib/project-scope";
export * from "./lib/read-store";
export * from "./lib/reader-find";
export * from "./lib/rsi-methods";
export * from "./lib/server-context";
export * from "./lib/session-grouping";
export * from "./lib/session-machines";
export * from "./lib/session-row-contributions";
export * from "./lib/session-source-mark";
export * from "./lib/settings-request";
export * from "./lib/settings-sections";
export * from "./lib/shortcuts/chord";
export * from "./lib/shortcuts/format";
export * from "./lib/shortcuts/platform";
export * from "./lib/shortcuts/registry";
export * from "./lib/shortcuts/reserved";
export * from "./lib/shortcuts/store";
export * from "./lib/shortcuts/types";
export * from "./lib/shortcuts/use-keymap";
export * from "./lib/skill-use";
export * from "./lib/stat-icons";
export * from "./lib/strings";
export * from "./lib/toast-api-error";
export * from "./lib/tone";
export * from "./lib/usage-controls";
export * from "./lib/use-document-title";
export * from "./lib/use-opened-in-project";
export * from "./lib/use-rsi-toolkits";
export * from "./lib/workspace-machines";
export * from "./lib/workspace-tree";
export * from "./state/auth";
export * from "./state/background";
export * from "./state/locale";
export * from "./state/machines";
export * from "./state/project";
export * from "./state/sessions";
export * from "./state/theme-entries";
export * from "./state/theme-prefs";
export * from "./state/theme";

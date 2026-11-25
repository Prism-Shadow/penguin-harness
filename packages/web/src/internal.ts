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
export * from "./components/ui/avatar-picker";
export * from "./lib/agent-avatar";
export * from "./lib/agent-deletion-progress";
export * from "./lib/agent-employment";
export * from "./lib/agent-location";
export * from "./lib/agent-plugin-install";
export * from "./lib/api-error";
export * from "./lib/app-center-path";
export * from "./lib/archive-download";
export * from "./lib/card-open";
export * from "./lib/failure";
export * from "./lib/format";
export * from "./lib/instant-setting";
export * from "./lib/machine-agent-lists";
export * from "./lib/machine-link";
export * from "./lib/model-grouping";
export * from "./lib/nav-icons";
export * from "./lib/plugin-modules";
export * from "./lib/project-change-events";
export * from "./lib/project-scope";
export * from "./lib/project-settings-location";
export * from "./lib/read-store";
export * from "./lib/running-apps";
export * from "./lib/semantic-id";
export * from "./lib/sidebar-contributions";
export * from "./lib/skill-use";
export * from "./lib/stat-icons";
export * from "./lib/strings";
export * from "./lib/system-apps";
export * from "./lib/toast-api-error";
export * from "./lib/tone";
export * from "./lib/use-document-title";
export * from "./lib/use-opened-in-project";
export * from "./lib/workbench-shortcut";
export * from "./lib/workbench-tabs";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/machines";
export * from "./state/project";
export * from "@prismshadow/penguin-library-agent/web";

export * from "./features/ai-create";
export * from "./features/chat";
export * from "./features/model-picker";
export * from "./features/models";
export * from "./features/plugins";
export * from "./features/schedules";
export * from "./features/semantic-id";
export * from "./features/skills";
export * from "./features/todos";
export * from "./features/workbenches";
export * from "./features/workspace";

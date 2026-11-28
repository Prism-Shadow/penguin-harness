/**
 * The web app's internals the domain packages' web halves compile against, one surface: each
 * domain's web half under library/ consumes the web host through this subpath
 * (`@prismshadow/penguin-web/internal`), so its imports name one seam instead of reaching into
 * the host's file tree.
 *
 * Leaf sources only: every file a statement here forwards from is free of runtime imports of the
 * moved halves' faces, so loading this hub can never loop back into a moved module. (The one face
 * mention, lib/strings.ts's model group sort, is a type-only import and compiles away.) The
 * forwards from the app's feature modules — whose pages import the moved halves' faces — live in
 * the sibling hub (`@prismshadow/penguin-web/internal-hub`, src/internal-hub.ts), which the moved
 * halves read their feature names through only where the name is read after loading.
 *
 * The re-export order is the load cycle's protection: the library-face re-exports below pull the
 * moved code back in while this file is still loading, and a moved module's body can run then —
 * so every leaf a moved module's body reads is re-exported above those faces.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */
export * from "./api/client";
export * from "./api/endpoints";
export * from "./api/tool-types";
export * from "./api/sse";
export { useMachines } from "./state/machines";
export * from "./components/ui/avatar-picker";
export * from "./components/ui/stat-hint";
export * from "./lib/agent-avatar";
export * from "./lib/agent-deletion-progress";
export * from "./lib/agent-employment";
export * from "./lib/agent-location";
export * from "./lib/agent-plugin-install";
export * from "./lib/api-error";
export * from "./lib/app-center-path";
export * from "./lib/archive-download";
export * from "./lib/builtin-agents";
export * from "./lib/card-open";
export * from "./lib/chat-session";
export * from "./lib/context";
export * from "./lib/default-models-request";
export * from "./lib/desktop-renderer";
export * from "./lib/dock-panel-empty";
export * from "./lib/failure";
export * from "./lib/format";
export * from "./lib/history/history-read";
export * from "./lib/instant-setting";
export * from "./lib/local-first";
export * from "./lib/machine-agent-lists";
export * from "./lib/machine-link";
export * from "./lib/model-grouping";
export * from "./lib/model-group-order";
export * from "./lib/model-onboarding";
export * from "./lib/model-tags";
export * from "./lib/nav-icons";
export * from "./lib/plugin-modules";
export * from "./lib/project-change-events";
export * from "./lib/project-scope";
export * from "./lib/project-settings-location";
export * from "./lib/protocol-client-types";
export * from "./lib/read-store";
export * from "./lib/running-apps";
export * from "./lib/semantic-id";
export * from "./lib/sidebar-contributions";
export * from "./lib/skill-use";
export * from "./lib/stat-icons";
export * from "./lib/status-tone";
export * from "./lib/strings";
export * from "./lib/system-app-notes";
export * from "./lib/system-apps";
export * from "./lib/todo-dismissals";
export * from "./lib/toast-api-error";
export * from "./lib/tone";
export * from "./lib/use-document-title";
export * from "./lib/use-opened-in-project";
export * from "./lib/use-project-todos";
export * from "./lib/use-update-badges";
export * from "./lib/workbench-shortcut";
export * from "./lib/workbench-tabs";
export * from "./state/auth";
export * from "./state/locale";
export * from "./state/machines";
export * from "./state/project";
export * from "./state/theme";
export * from "./state/use-tool-bindings";
export * from "@prismshadow/penguin-library-agent/web";
export * from "@prismshadow/penguin-library-model/web";
export * from "@prismshadow/penguin-library-project/web";
export * from "@prismshadow/penguin-library-trace/web";

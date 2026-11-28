/**
 * The web app's feature modules' names the domain packages' web halves consume, one surface beside
 * the leaf hub (`@prismshadow/penguin-web/internal`): these forwards come from the app's feature
 * modules, whose pages import the moved halves' faces, so this file's graph reaches into the moved
 * code and its names are for reading after loading (a render, a call), never while a module body
 * runs — the leaf names a moved module's body needs come from the leaf hub.
 *
 * Deliberately a re-export hub and nothing more: no logic, no defaults.
 */

export * from "./features/ai-create";
export * from "./features/chat";
export * from "./features/chat/history-loading";
export * from "./features/dock";
export * from "./features/plugins";
export * from "./features/schedules";
export * from "./features/semantic-id";
export * from "./features/skills";
export * from "./features/todos";
export * from "./features/workbenches";
export * from "./features/workspace";

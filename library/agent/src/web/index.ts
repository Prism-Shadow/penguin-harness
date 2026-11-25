/**
 * The agents domain's web half: the Agent settings pages and their dialogs, in one entry. The
 * Web App boots the feature's module as its own (web-root.ts); the face carries the feature's
 * public vocabulary for the sibling domains, and the default export the Web App's generated
 * plugin list reads — empty, since nothing here boots as a plugin.
 */
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";

export { AgentsModule } from "./agents/module";
export * from "./agents";

export default { modules: [] as readonly ModuleClass[] };

/**
 * The projects domain's web half: the Project switcher and its dialogs, in one entry. The Web App
 * boots the feature's module as its own (web-root.ts); the face carries the switcher's public
 * vocabulary for the sibling domains, and the default export the Web App's generated plugin list
 * reads — empty, since nothing here boots as a plugin.
 */
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";

export { ProjectsModule } from "./projects/module";
export * from "./projects";

export default { modules: [] as readonly ModuleClass[] };

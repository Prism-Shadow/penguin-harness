/**
 * The models domain's web half: the model configuration pages, the sidebar badges module and the
 * model picker, in one entry. The Web App boots these features' modules as its own (web-root.ts);
 * the face carries their public vocabulary for the sibling domains, and the default export the
 * Web App's generated plugin list reads — empty, since nothing here boots as a plugin.
 */
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";

export { ModelsModule } from "./models/module";
export { MainSidebarBadgesModule } from "./models/main-sidebar-badges.module";
export * from "./models";
export * from "./model-picker";

export default { modules: [] as readonly ModuleClass[] };

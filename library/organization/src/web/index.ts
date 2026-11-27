/**
 * The organization domain's web half: company mode (its pages, sidebar mode and state) and the
 * admin users section, in one entry. The Web App boots company mode's module as its own
 * (web-root.ts); the face carries their public vocabulary for the sibling domains, and the
 * default export the Web App's generated plugin list reads — empty, since nothing here boots as
 * a plugin.
 */
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";

export { CompanyModule } from "./company/module";
export * from "./company/index";
export * from "./admin/index";

export default { modules: [] as readonly ModuleClass[] };

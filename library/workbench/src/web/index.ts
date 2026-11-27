/**
 * The workbench domain's web half: the Agent's workbench pages and the App Center, in one
 * entry. The Web App boots these features' modules as its own (web-root.ts imports them
 * through this face); the face carries their public vocabulary for the sibling domains. The
 * Web App compiles these sources with itself — the package's own build (tsup, dist) carries
 * none of them, and nothing here boots as a plugin.
 */
export { WorkbenchesModule } from "./workbenches/module";
export { AppCenterModule } from "./app-center/module";
export * from "./workbenches/index";
export * from "./app-center/index";

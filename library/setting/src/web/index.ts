/**
 * The settings domain's web half: the Settings dialog and its runtime, compiled by the Web
 * App's program from this package's `./web` entry. The module class joins the app's own
 * modules in web-root.ts; the host reads the dialog back through its internal surface.
 */
export { SettingsModule } from "./module";
export { SettingsDialog } from "./settings-dialog";

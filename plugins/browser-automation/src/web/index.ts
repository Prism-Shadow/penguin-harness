/**
 * The agent browser's web half (`./web`), which the Web App compiles in at build time (its
 * generated list of plugin web halves, packages/web/scripts/gen-web-table.mjs): the module that
 * contributes it to the app's slots, and its endpoint wrappers, which the component gallery's
 * mock coverage check calls. The module is drawn only while the plugin's server module runs.
 */
import * as api from "./api";
import { BuiltinBrowserModule } from "./module";

export default { modules: [BuiltinBrowserModule], api };

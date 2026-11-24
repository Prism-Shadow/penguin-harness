/**
 * The Task Manager page's web half (`./web`), which the Web App compiles in at build time (its
 * generated list of plugin web halves, packages/web/scripts/gen-web-table.mjs): the module that
 * contributes the page to the app's slots, and its endpoint wrapper, which the component gallery's
 * mock coverage check calls. The page is drawn only while the plugin's server module runs.
 */
import * as api from "./api";
import { TaskManagerWebModule } from "./module";

export default { modules: [TaskManagerWebModule], api };

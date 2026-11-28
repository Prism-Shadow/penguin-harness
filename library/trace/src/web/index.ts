/**
 * The traces domain's web half: the trace panel, its dock panel and the trace rounds' charts, in
 * one entry. The Web App boots the feature's module as its own (web-root.ts); the face carries
 * the trace vocabulary the other domains read (lane packing), and the default export the Web
 * App's generated plugin list reads — empty, since nothing here boots as a plugin.
 */
import type { ModuleClass } from "@prismshadow/penguin-core/kernel";

export { TracesModule } from "./traces/module";
export * from "./traces";

export default { modules: [] as readonly ModuleClass[] };

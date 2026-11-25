/**
 * The connection test of a tool model moved to the model domain package
 * (@prismshadow/penguin-library-model/tool-model-test, services+http+cli restack S13) — it
 * speaks only core's streamProjectModel vocabulary and the model domain's DTOs. This re-export
 * keeps the server's own import paths stable.
 */
export { testToolModel } from "@prismshadow/penguin-library-model/tool-model-test";
export type {
  ToolModelTestBody,
  ToolModelTestOptions,
} from "@prismshadow/penguin-library-model/tool-model-test";

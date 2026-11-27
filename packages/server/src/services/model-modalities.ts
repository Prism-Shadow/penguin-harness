/**
 * What MMSP knows about a configured model moved to the model domain package
 * (@prismshadow/penguin-library-model/model-modalities, services+http+cli restack S13) — it
 * speaks only MMSP's registry and core's endpoint vocabulary. This re-export keeps the server's
 * own import paths stable.
 */
export {
  modelModalities,
  type ModelModalities,
} from "@prismshadow/penguin-library-model/model-modalities";

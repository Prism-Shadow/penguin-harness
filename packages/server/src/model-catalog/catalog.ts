/**
 * The model catalog moved to the model domain package (@prismshadow/penguin-library-model,
 * services+http+cli restack S1); this re-export keeps the server's own import paths — and the
 * browser-safe `@prismshadow/penguin-server/model-catalog` subpath the Web App imports — stable.
 */
export * from "@prismshadow/penguin-library-model/model-catalog/catalog";

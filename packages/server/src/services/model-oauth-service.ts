/**
 * The model OAuth flow moved to the model domain package
 * (@prismshadow/penguin-library-model/model-oauth-service, services+http+cli restack S1) —
 * the Component is pure library vocabulary and deps, so it went whole. This re-export keeps
 * the server's own import paths stable: the platform assembly registers the class from here.
 */
export * from "@prismshadow/penguin-library-model/model-oauth-service";

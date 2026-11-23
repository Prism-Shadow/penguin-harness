/**
 * Stable identifiers for Penguin Go's key-authorization flow. The shapes moved to the model
 * domain package (@prismshadow/penguin-library-model, services+http+cli restack S1) —
 * `platform-auth-flow` carries the client id, the normalized catalog shapes and the flow wire
 * shapes. This re-export keeps the server's own import paths stable.
 */
export { PLATFORM_CLIENT_ID } from "@prismshadow/penguin-library-model/platform-auth-flow";
export type {
  PlatformCatalogPricing,
  PlatformCatalogModel,
  PlatformModelCatalog,
  PlatformModelApplyResult,
  PlatformAuthStartResponse,
  PlatformAuthFlowErrorCode,
  PlatformAuthFlowStatusResponse,
} from "@prismshadow/penguin-library-model/platform-auth-flow";

/**
 * The models domain as a library package: the model/credential plumbing vocabulary (the
 * DTOs the models routes return and take), the ModelOAuth mechanism and its flow vocabulary,
 * and the promotions / provider auth token repos their contracts name. One package, no
 * server dependencies - the repos take the Db capability from @prismshadow/penguin-library-db
 * and the model reference from @prismshadow/penguin-library-agent-api.
 *
 * Subpaths:
 * - `.` - the vocabulary plus the mechanisms.
 * - `./model` - the vocabulary module on its own.
 * - `./model-balance`, `./model-modalities`, `./tool-binding-key`, `./tool-model-test`,
 *   `./tool-model-bindings` - the balance reader, the modality probe, the binding-key grammar,
 *   the tool model's connection test and the tool-model bindings module.
 * - `./repos/model-promotions`, `./repos/model-provider-auth-tokens` - the storing components.
 */
export type {
  PricingRates,
  TieredRates,
  PlatformCatalogPricing,
  ModelPricingDto,
  PlatformCatalogModel,
  PlatformModelCatalog,
  PlatformModelApplyResult,
  ModelInfo,
  CredentialInfo,
  ConnectionSourceDto,
  ModelEffectiveConnection,
  ModelsResponse,
  ModelUpdateEntry,
  ModelsUpdateRequest,
  ProviderConnectionUpdate,
  ToolModelBindingView,
  ToolModelBindingsResponse,
  ToolModelBindingUpdate,
  ProviderConnectionDto,
  ProviderConnectionResponse,
  PresetSyncMode,
  PresetSyncResponse,
  DefaultModelOffer,
  GroupKeyApplied,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionOutcome,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  ModelProtocolDetectRequest,
  ProtocolProbeOutcome,
  ModelProtocolProbeDto,
  ModelProtocolDetectResponse,
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelBalanceAmount,
  ModelBalanceErrorCode,
  ModelBalanceFailure,
  ModelBalanceReading,
  ModelBalanceResponse,
  ModelOAuthErrorCode,
  ModelOAuthMode,
  ModelOAuthStartResult,
  ModelOAuthStatus,
  ModelPromotion,
  ModelProviderAuthToken,
} from "./model.js";
export { ModelPromotions, ModelProviderAuthTokens, ModelOAuth } from "./model.js";
export { ModelPromotionsRepo } from "./repos/model-promotions.js";
export { ModelProviderAuthTokensRepo } from "./repos/model-provider-auth-tokens.js";
export { ModelBalances, microToDecimal, readBalance } from "./model-balance.js";
export type { BalanceFigures, ModelBalanceDeps } from "./model-balance.js";
export { testToolModel } from "./tool-model-test.js";
export { modelModalities } from "./model-modalities.js";
export { toolBindingKeyFault } from "./tool-binding-key.js";
export { ToolModelBindings, toolModelBindingsOver, validBindings } from "./tool-model-bindings.js";
export type { ModelModalities } from "./model-modalities.js";
export type { ToolModelTestBody, ToolModelTestOptions } from "./tool-model-test.js";
export type {
  Collected,
  DeclaredBinding,
  ToolModelBindingCode,
  ToolModelBindingData,
  ToolModelBindingsConfig,
  ToolModelBindingsSlots,
  ToolModelBindingTitle,
  ToolModelCandidate,
  ToolModelTestRequest,
  ToolModelTestSubject,
} from "./tool-model-bindings.js";

/**
 * MMSP's stream event envelope, as the model-request contracts name it in their streams
 * (Opaque<"UniEvent", …>): a host object compared by name, re-exported here so the
 * packages that speak the model plumbing name it from this package.
 */
export type { UniEvent } from "@prismshadow/mmsp";

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

/**
 * The model OAuth flow. The service moved to the model domain package
 * (@prismshadow/penguin-library-model/model-oauth-service, services+http+cli restack S1) —
 * it speaks only library vocabulary and constructor deps. This file keeps the assembly: the
 * Provider binds the service's key-write port to the Project config (a server-owned
 * mechanism; binding it in the library would make library/model depend on
 * library/project, which itself depends on library/model), and it re-exports the moved
 * shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import { ModelOAuth } from "@prismshadow/penguin-library-model";
import { ModelOAuthService } from "@prismshadow/penguin-library-model/model-oauth-service";

export {
  ModelOAuthService,
  FLOW_TTL_MS,
  openedMode,
  createVerifier,
  codeChallenge,
  buildAuthorizeUrl,
  exchangeCode,
} from "@prismshadow/penguin-library-model/model-oauth-service";
export type { ModelOAuthServiceDeps } from "@prismshadow/penguin-library-model/model-oauth-service";
export type {
  ModelOAuthErrorCode,
  ModelOAuthMode,
  ModelOAuthStartResult,
  ModelOAuthStatus,
  ExchangeResult,
  ApplyGroupKey,
} from "@prismshadow/penguin-library-model/model-oauth-service";

/** The flow assembly: binds the minted-key write to the Project config. */
@Module()
export class ModelOAuthProvider {
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Provide() oauth!: ModelOAuth;

  setup() {
    this.oauth = new ModelOAuthService({
      applyGroupKey: (projectId, provider, apiKey) =>
        this.projectConfig.setGroupApiKey(projectId, provider, apiKey),
    });
  }
}

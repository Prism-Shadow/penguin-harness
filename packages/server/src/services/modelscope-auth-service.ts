/**
 * The ModelScope key authorization flow. The service and its capability interface moved to
 * the model domain package (@prismshadow/penguin-library-model/modelscope-auth-service,
 * services+http+cli restack S1) — they speak only library vocabulary and constructor
 * deps. This file keeps the assembly: the Provider reads the bridge URL off the server's
 * Config capability and wires the library service to the project config and the auth-token
 * repo, and it re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { MODELSCOPE_PROVIDER_ID } from "../model-catalog/catalog.js";
import { normalizeModelScopeBridgeUrl } from "../config.js";
import { Config } from "../hmr/capabilities.js";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { ModelProviderAuthTokens } from "@prismshadow/penguin-library-model";
import {
  ModelScopeAuth,
  ModelScopeAuthService,
} from "@prismshadow/penguin-library-model/modelscope-auth-service";

export {
  MODELSCOPE_BRIDGE_CLIENT_ID,
  ModelScopeAuth,
  ModelScopeAuthService,
  modelscopeAccessToken,
  modelscopeCredential,
  modelscopeRefreshCredential,
} from "@prismshadow/penguin-library-model/modelscope-auth-service";
export type {
  ModelScopeAuthStatusResult,
  ModelScopeCredential,
  ModelScopeRefreshResult,
} from "@prismshadow/penguin-library-model/modelscope-auth-service";

/** Keep in-flight flows on the current bridge, like PlatformAuthProvider keeps them on Penguin Go. */
@Module()
export class ModelScopeAuthProvider {
  @Use() private readonly config!: Config;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly providerAuthTokens!: ModelProviderAuthTokens;
  @Provide() auth!: ModelScopeAuth;

  setup() {
    this.auth = new ModelScopeAuthService({
      // A runtime older than the field publishes none; the default is the production bridge.
      bridgeUrl: this.config.modelscopeBridgeUrl ?? normalizeModelScopeBridgeUrl(undefined),
      applyCredential: async (projectId, credential, options) => {
        if (credential.refreshToken !== undefined) {
          return this.projectConfig.setGroupApiKeyWithProviderAuthToken(
            projectId,
            MODELSCOPE_PROVIDER_ID,
            credential.accessToken,
            {
              refreshToken: credential.refreshToken,
              accessTokenExpiresAt: credential.expiresAt,
            },
            options,
          );
        }
        const { applied } = await this.projectConfig.setGroupApiKey(
          projectId,
          MODELSCOPE_PROVIDER_ID,
          credential.accessToken,
        );
        return applied;
      },
      readStoredCredential: (projectId) =>
        this.providerAuthTokens.get(projectId, MODELSCOPE_PROVIDER_ID),
    });
  }
}

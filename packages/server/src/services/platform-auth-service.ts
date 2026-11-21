/**
 * The Penguin Go key authorization flow. The service and its capability interface moved to
 * the model domain package (@prismshadow/penguin-library-model/platform-auth-service,
 * services+http+cli restack S1) — they speak only library vocabulary and constructor deps.
 * This file keeps the assembly: the Provider reads the platform origin off the server's
 * Config capability and wires the library service to the project config, and it re-exports
 * the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { PENGUIN_GO_PROVIDER_ID } from "../model-catalog/catalog.js";
import { normalizePenguinGoOrigin } from "../config.js";
import { Config } from "../hmr/capabilities.js";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import {
  PlatformAuth,
  PlatformAuthService,
} from "@prismshadow/penguin-library-model/platform-auth-service";

export {
  PlatformAuth,
  PlatformAuthService,
  platformConnection,
} from "@prismshadow/penguin-library-model/platform-auth-service";
export type { PlatformAuthStatusResult } from "@prismshadow/penguin-library-model/platform-auth-service";

/** Keep in-flight flows on the current platform App, like ModelOAuthService. */
@Module()
export class PlatformAuthProvider {
  @Use() private readonly config!: Config;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Provide() auth!: PlatformAuth;

  setup() {
    this.auth = new PlatformAuthService({
      // A runtime older than the field publishes none; the default is the production origin.
      origin: this.config.penguinGoOrigin ?? normalizePenguinGoOrigin(undefined),
      getKey: (projectId) => this.projectConfig.getGroupApiKey(projectId, PENGUIN_GO_PROVIDER_ID),
      applyCatalog: (projectId, catalog, apiKey, applyKeyToExisting) =>
        this.projectConfig.mergePlatformModels(
          projectId,
          PENGUIN_GO_PROVIDER_ID,
          catalog,
          apiKey,
          applyKeyToExisting,
        ),
    });
  }
}

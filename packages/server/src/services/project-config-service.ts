/**
 * The `.project_config.toml` store moved to the projects domain package
 * (@prismshadow/penguin-library-project/project-config-service, server restack S11) — it
 * takes a paths port and the optional promotions / provider auth token repos. This file
 * keeps the assembly: the Provider binds those decorator-injected fields by hand and
 * re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { ModelPromotions, ModelProviderAuthTokens } from "@prismshadow/penguin-library-model";
import type { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import { ProjectConfigService } from "@prismshadow/penguin-library-project/project-config-service";

export * from "@prismshadow/penguin-library-project/project-config-service";

/** The config assembly: the store's decorator-injected fields are bound by hand here (the kernel does not inject @Use on a hand-built instance). */
@Module()
export class ProjectConfigServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly promotions?: ModelPromotions;
  @Use() private readonly providerAuthTokens?: ModelProviderAuthTokens;
  @Provide() config!: ProjectConfigStore;
  @Provide() service!: ProjectConfigService;

  setup() {
    this.service = Object.assign(new ProjectConfigService(), {
      paths: this.paths,
      promotions: this.promotions,
      providerAuthTokens: this.providerAuthTokens,
    });
    this.config = this.service;
  }
}

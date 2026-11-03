/**
 * The company group's server half: the organization runtime, its HTTP routes and the
 * caches they project into. One module, assembled by the platform tree as a child of the
 * root exactly as when it lived in packages/server — only its address has changed. The
 * caches are the group's own store — only the four members the session runtime and
 * Project deletion reach for leave the group, as OrgCache.
 */
import { Module } from "@prismshadow/penguin-core/kernel";
import { OrgCacheRepo } from "@prismshadow/penguin-server/internal";
import { OrgRoutes } from "./routes/organizations.js";
import { OrganizationModule, OrgScheduler, OrgService } from "./runtime/service.js";
import type { OrgCache } from "@prismshadow/penguin-server/internal";

export { OrgRuns, OrgSessions } from "./runtime/deps.js";

@Module({
  children: [OrgCacheRepo, OrganizationModule, OrgRoutes],
  exports: [OrgCache, OrgService, OrgScheduler],
})
export class CompanyModule {}

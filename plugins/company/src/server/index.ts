/**
 * The company group's server half: the organization runtime, its HTTP routes and the
 * caches they project into. One module, assembled by the platform tree as a child of the
 * root exactly as when it lived in packages/server — only its address has changed. The
 * caches are the group's own store — only the four members the session runtime and
 * Project deletion reach for leave the group, as OrgCache.
 */
import { Module } from "@prismshadow/penguin-core/kernel";
import { OrgCacheRepo } from "@prismshadow/penguin-server/db/repos/organizations";
import { OrgCache } from "./mechanisms-organization.js";
import { OrgRoutes } from "./routes/organizations.js";
import { OrganizationModule, OrgScheduler, OrgService } from "./runtime/service.js";

export { OrgRuns, OrgSessions } from "./runtime/deps.js";
export { OrgService, OrgScheduler } from "./runtime/service.js";

@Module({
  children: [OrgCacheRepo, OrganizationModule, OrgRoutes],
  exports: [OrgCache, OrgService, OrgScheduler],
})
export class CompanyModule {}
export { OrgCache } from "./mechanisms-organization.js";

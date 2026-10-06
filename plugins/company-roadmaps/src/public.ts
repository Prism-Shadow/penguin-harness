/**
 * The package's public surface beside the plugin module itself (index.ts): the domain, the
 * store, the default guards, the built-in Actions and notices, the room helpers, the
 * service and the page, for other packages and the tests to import.
 */
export { RoadmapError, orgDirOf } from "./domain.js";
export type {
  Delegation,
  DraftItem,
  ProposalItem,
  Roadmap,
  RoadmapItem,
  RoadmapStatus,
  RoadmapWrite,
} from "./domain.js";
export { COMPANY_DB, ROADMAP_SCHEMA, companyDbPath, openCompanyDb } from "./schema.js";
export { SqliteRoadmapStore, briefSha } from "./store.js";
export type { RoadmapStore } from "./ports.js";
export {
  DEFAULT_APPROVAL_ROLES,
  approvalRole,
  defaultAct,
  moderatorOf,
  requireStatus,
  roadmapGuards,
  rolesOf,
  verdictRoles,
  withApprovalRoles,
} from "./guards.js";
export type { Caller, WriteAct } from "./guards.js";
export {
  ROADMAP_ACTION_IDS,
  ROADMAP_SUBJECTS_ID,
  roadmapCode,
  writeActOf,
} from "./builtin-actions.js";
export type * from "./action-shapes.js";
export { CHANNEL_ID, agentMembers, readRoom } from "./room.js";
export type { RoomConfig } from "./room.js";
export { RoadmapService, basesOf, headingsOf, parseItems, unknownCites } from "./service.js";
export type { RoadmapView, ServiceDeps, WriteResult } from "./service.js";
export { changeMembers, parseMembers } from "./members.js";
export type { MembersHost, MembersRequest } from "./members.js";
export { ROUTES_ID, roadmapRoutes } from "./routes.js";
export {
  PAGE_PREFIX,
  PAGE_ROUTES_ID,
  PAGE_SRC,
  PAGE_STRINGS,
  PAGE_TIMEOUT_MS,
  THEME_HREF,
  THEME_VARS,
  pageHtml,
  pageRoutes,
} from "./page.js";
export {
  ModeratorRegistration,
  ProposalCreator,
  ProposalRoadmapsRegistration,
  proposalRoadmapLinks,
  roadmapModerators,
} from "./proposals.js";
export type { ProposalRoadmapLinks, RoadmapModeratorOf } from "./proposals.js";
export * from "./notices.js";
export { RetiredOrgs, retireListeners, retireRegistered } from "./org-retire.js";
export type { OrgRef, RetireListener } from "./org-retire.js";

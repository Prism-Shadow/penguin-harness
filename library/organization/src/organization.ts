/**
 * The organization mechanisms: what a node may require, declared apart from what
 * implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import type { OrgCacheRepo } from "./organizations.js";

/** From packages/server (api/types.ts): the org runtime's calendar/ticket outcomes -
 * the org cache rows carry them. */
export type OrgCalendarOutcome = "fired" | "queued" | "paused" | "missed" | "error";

export type OrgTicketChange = "assigned" | "blocked" | "blocker_closed" | "done" | "rejected";

/**
 * OrgCache: the mechanism OrgCacheRepo implements. The whole repo, except that
 * `orgIdsOfProject` is named rather than inherited — a Map has no wire form, so the
 * contract carries it as an opaque host object the way the kernel's other live values are.
 */
export abstract class OrgCache extends Interface<
  Omit<OrgCacheRepo, "orgIdsOfProject"> & {
    orgIdsOfProject(projectId: string): Opaque<"OrgIdsBySession", Map<string, string>>;
  }
>() {}

/**
 * The Storage page's endpoint wrappers over the face's `apiFetch`, so they run on the Web App's
 * transport (and its test and gallery stand-ins) without importing the Web App. The component
 * gallery's mock coverage check walks this module beside the app's own `api/endpoints.ts`.
 *
 * Deleting chats is the archive page's batch (`POST /api/me/archived-sessions/delete`), the
 * host's single-Session delete path; the page adds none of its own.
 */
import type {
  ArchivedSessionsBatch,
  ArchivedSessionsBatchResponse,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "@prismshadow/penguin-web-plugin";
import type {
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageCleanupReview,
  StorageRevealRequest,
  StorageSessionsQuery,
  StorageSessionsResponse,
  StorageUsage,
} from "../types";

/**
 * What the data root holds by category, as last measured: the caller's Projects, and for an
 * admin the whole root. The first read of a unit never measured starts its measurement.
 */
export const getStorageUsage = () => apiFetch<StorageUsage>("/api/me/storage");

/** Measures the caller's units again (one already under way is reused); answers like getStorageUsage. */
export const refreshStorageUsage = () =>
  apiFetch<StorageUsage>("/api/me/storage/refresh", { method: "POST", body: {} });

/** What can be removed safely now, an idle scratchpad being one last active `olderThanDays` ago. */
export const getStorageCleanup = (olderThanDays: number) =>
  apiFetch<StorageCleanupReview>("/api/me/storage/cleanup", { query: { olderThanDays } });

/** Removes the chosen items of a review, each judged again by the review's rule. */
export const runStorageCleanup = (body: StorageCleanupRequest) =>
  apiFetch<StorageCleanupResult>("/api/me/storage/cleanup", { method: "POST", body });

/**
 * The Sessions of the caller's Projects by size or last activity, at most 500; deleting them goes
 * through deleteSessions.
 */
export const listStorageSessions = (query: StorageSessionsQuery) =>
  apiFetch<StorageSessionsResponse>("/api/me/storage/sessions", {
    query: {
      projectId: query.projectId,
      agentId: query.agentId,
      listing: query.listing,
      olderThanDays: query.olderThanDays,
      sort: query.sort,
    },
  });

/** Shows a Project's folder, or the data root (admins), in the desktop's file manager. */
export const revealStorageFolder = (body: StorageRevealRequest) =>
  apiFetch<void>("/api/me/storage/reveal", { method: "POST", body });

/** Deletes the named Sessions with their subagent children: the archive page's batch. */
export const deleteSessions = (target: ArchivedSessionsBatch) =>
  apiFetch<ArchivedSessionsBatchResponse>("/api/me/archived-sessions/delete", {
    method: "POST",
    body: target,
  });

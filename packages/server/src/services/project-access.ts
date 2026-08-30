/**
 * Who may see a Project: the owner / member decision, in ONE place.
 *
 * Split from ProjectService so that access control sits below everything that runs a
 * Session: nearly every route checks access first, and the session runtime is what
 * project LIFECYCLE (delete, destroy) depends on — the two cannot live in one module
 * without a cycle. Lifecycle stays in ProjectService and delegates its checks here.
 */
import type { ProjectRole, ProjectSummary } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { ProjectRow } from "../db/repos/projects.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Access, Members, ProjectConfigStore, Projects } from "../mechanisms/projects.js";

@Component()
export class ProjectAccess implements Access {
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  /** Display names come from each project's own config file. */
  @Use() private readonly projectConfig!: ProjectConfigStore;

  /**
   * The sole implementation of the owner / member check: the row with a role when
   * accessible, otherwise null. Every other member here is a wrapper around it.
   */
  find(userId: string, projectId: string): (ProjectRow & { role: ProjectRole }) | null {
    const row = this.projects.findById(projectId);
    if (!row) return null;
    if (row.ownerUserId === userId) return { ...row, role: "owner" };
    if (this.members.isMember(projectId, userId)) return { ...row, role: "member" };
    return null;
  }

  /** Accessible by owner or member; otherwise 404 (does not leak Project existence). */
  requireProjectAccess(userId: string, projectId: string): ProjectRow & { role: ProjectRole } {
    const row = this.find(userId, projectId);
    if (!row) {
      throw new HttpError(
        404,
        "project_not_found",
        "Project does not exist or you do not have access.",
      );
    }
    return row;
  }

  /** The non-throwing form, for error attribution — where another 404 would only break error handling. */
  canAccess(userId: string, projectId: string): boolean {
    return this.find(userId, projectId) !== null;
  }

  /** Owner only: 403 when known accessible as a member; 404 when not accessible. */
  requireProjectOwner(userId: string, projectId: string): ProjectRow {
    const row = this.requireProjectAccess(userId, projectId);
    if (row.role !== "owner") {
      throw new HttpError(
        403,
        "owner_required",
        "Only the Project owner can perform this operation.",
      );
    }
    return row;
  }

  /** Every project_id the user may reach (owned + granted). */
  accessibleProjectIds(userId: string): string[] {
    return this.projects.listAccessible(userId).map((p) => p.projectId);
  }

  /** Owned + granted Projects with their display names. */
  async listProjects(userId: string): Promise<ProjectSummary[]> {
    const rows = this.projects.listAccessible(userId);
    return Promise.all(
      rows.map(async (row) => {
        const name = await this.projectConfig.getName(row.projectId);
        return {
          projectId: row.projectId,
          ...(name !== undefined ? { name } : {}),
          role: row.role,
          ownerUserId: row.ownerUserId,
          createdAt: row.createdAt,
        };
      }),
    );
  }
}

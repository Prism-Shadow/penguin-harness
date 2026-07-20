/**
 * Project service.
 *
 * The single implementation point for authorization rules: `requireProjectAccess`
 * (owner or member, otherwise 404 without leaking existence) and
 * `requireProjectOwner` (owner only; 403 when known to be accessible, 404 when not)
 * are reused by every route; the non-throwing `canAccess` (for error attribution)
 * is likewise just a sibling wrapper around them — all three share the single
 * `resolveAccess` decision, with no second rule set maintained separately.
 * Also handles Project create / list / delete, member authorization, and initial
 * Project provisioning at signup.
 */
import fs from "node:fs/promises";
import { DEFAULT_PROJECT_ID, projectDir, provisionProjectAgents } from "@prismshadow/penguin-core";
import type { MemberInfo, ProjectRole, ProjectSummary } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { AgentsRepo } from "../db/repos/agents.js";
import type { ErrorsRepo } from "../db/repos/errors.js";
import type { MembersRepo } from "../db/repos/members.js";
import type { ProjectRow, ProjectsRepo } from "../db/repos/projects.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { SchedulesRepo } from "../db/repos/schedules.js";
import type { UsageRepo } from "../db/repos/usage.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import type { SessionManager } from "../runtime/session-manager.js";
import {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_SUFFIX_PATTERN,
  SEMANTIC_ID_PATTERN,
  SEMANTIC_ID_RULE,
} from "./ids.js";
import type { ProjectConfigService } from "./project-config-service.js";

/** Fallback timeout for waiting on runs to settle before deleting a Project. */
const ABORT_SETTLE_TIMEOUT_MS = 5000;

async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export interface ProjectServiceDeps {
  root: string;
  users: UsersRepo;
  projects: ProjectsRepo;
  members: MembersRepo;
  agents: AgentsRepo;
  sessions: SessionsRepo;
  usage: UsageRepo;
  errors: ErrorsRepo;
  schedules: SchedulesRepo;
  projectConfig: ProjectConfigService;
  manager: SessionManager;
}

export class ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  // —— Authorization rules (single implementation point) ——

  /**
   * The **sole** implementation of the owner / member check: returns the row with
   * a role if accessible, otherwise null. `requireProjectAccess` below (throws 404)
   * and `canAccess` (returns boolean) are both just wrappers around it — there's
   * only one copy of the decision rule, since writing it twice would eventually
   * drift out of sync.
   */
  private resolveAccess(
    userId: string,
    projectId: string,
  ): (ProjectRow & { role: ProjectRole }) | null {
    const row = this.deps.projects.findById(projectId);
    if (!row) return null;
    if (row.ownerUserId === userId) return { ...row, role: "owner" };
    if (this.deps.members.isMember(projectId, userId)) return { ...row, role: "member" };
    return null;
  }

  /** Accessible by owner or member; otherwise 404 (does not leak Project existence). */
  requireProjectAccess(userId: string, projectId: string): ProjectRow & { role: ProjectRole } {
    const row = this.resolveAccess(userId, projectId);
    if (!row) {
      throw new HttpError(
        404,
        "project_not_found",
        "Project does not exist or you do not have access.",
      );
    }
    return row;
  }

  /**
   * The non-throwing version of the same check: used for **error attribution**
   * (app.onError) — that runs on the error-handling path, where throwing another
   * 404 would only break error handling; whether access is granted shouldn't be
   * expressed as an exception there anyway.
   */
  canAccess(userId: string, projectId: string): boolean {
    return this.resolveAccess(userId, projectId) !== null;
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

  /** List of project_ids accessible to the current user (owned + granted access) (used by workspace-guard). */
  accessibleProjectIds(userId: string): string[] {
    return this.deps.projects.listAccessible(userId).map((p) => p.projectId);
  }

  // —— Project lifecycle ——

  /** List of owned + granted-access Projects; display names are read from each project_config.toml. */
  async listProjects(userId: string): Promise<ProjectSummary[]> {
    const rows = this.deps.projects.listAccessible(userId);
    return Promise.all(
      rows.map(async (row) => {
        const name = await this.deps.projectConfig.getName(row.projectId);
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

  /**
   * Create a Project: the id is chosen by the creator (a semantic id, checked for
   * duplicates against both the DB and the directory — 409 if taken), the initial
   * config is written (display name defaults to the id), and the built-in Agent is
   * initialized.
   * A non-admin's id is forced to be "<username>-<suffix>", where the suffix is
   * lowercase letters, digits, and underscores only — the hyphen is a reserved
   * separator, usernames never contain a hyphen, so the first hyphen is the
   * ownership boundary and the prefix can never be crafted from another username;
   * an admin's id contains no hyphen (occupying no user's namespace).
   */
  async createProject(owner: UserRow, projectId: string, name?: string): Promise<ProjectSummary> {
    if (owner.isAdmin) {
      if (!SEMANTIC_ID_PATTERN.test(projectId)) {
        throw new HttpError(
          400,
          "invalid_project_id",
          `Project id must be 2–64 characters: ${SEMANTIC_ID_RULE} (the hyphen is reserved as the user namespace separator).`,
        );
      }
    } else {
      const prefix = `${owner.userId}-`;
      const suffix = projectId.startsWith(prefix) ? projectId.slice(prefix.length) : "";
      if (!PROJECT_SUFFIX_PATTERN.test(suffix) || projectId.length > PROJECT_ID_MAX_LENGTH) {
        throw new HttpError(
          400,
          "project_id_prefix_required",
          `Project id must start with ${prefix}, followed by lowercase letters, digits or underscores (at most ${PROJECT_ID_MAX_LENGTH} in total).`,
        );
      }
    }
    if (
      this.deps.projects.findById(projectId) !== null ||
      (await dirExists(projectDir(this.deps.root, projectId)))
    ) {
      throw new HttpError(409, "project_exists", `Project id is already taken: ${projectId}.`);
    }
    const displayName = name ?? projectId;
    const createdAt = new Date().toISOString();
    // Insert the DB row first: the primary key is the final arbiter for concurrent
    // creation with the same id (the duplicate check above has an await gap), and a
    // conflict is mapped to 409 with **no cleanup** — the directory belongs to the
    // winner, and cleaning up here would wrongly delete the other side's data.
    try {
      this.deps.projects.insert({ projectId, ownerUserId: owner.userId, createdAt });
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new HttpError(409, "project_exists", `Project id is already taken: ${projectId}.`);
      }
      throw err;
    }
    // If file initialization fails, roll back the DB row and clean up the
    // directory: an orphaned directory would make retries with this id 409 forever
    // (a typical scenario: signup failure rolled back the user row, but the
    // <username>-default_project directory was left behind).
    try {
      await fs.mkdir(projectDir(this.deps.root, projectId), { recursive: true });
      await this.deps.projectConfig.writeInitialConfig(projectId, displayName);
      await this.provisionBuiltinAgents(projectId);
    } catch (err) {
      this.deps.projects.delete(projectId);
      await fs
        .rm(projectDir(this.deps.root, projectId), { recursive: true, force: true })
        .catch(() => {});
      throw err;
    }
    return {
      projectId,
      name: displayName,
      role: "owner",
      ownerUserId: owner.userId,
      createdAt,
    };
  }

  /**
   * Initial Project provisioned at signup:
   * the built-in admin adopts `default_project` (if the directory already exists,
   * it's adopted directly without overwriting existing config — shared with the
   * CLI); other users get `<username>-default_project` created, with display name
   * defaulting to the username.
   */
  async provisionInitialProject(user: UserRow, isAdmin: boolean): Promise<void> {
    if (!isAdmin) {
      await this.createProject(user, `${user.userId}-${DEFAULT_PROJECT_ID}`, user.userId);
      return;
    }
    const projectId = DEFAULT_PROJECT_ID;
    // Initialize the built-in Agent (loaded without overwriting if it already exists); this also ensures the directory exists.
    await this.provisionBuiltinAgents(projectId);
    // Adopting an existing directory doesn't go through writeInitialConfig: preset
    // models and the default model are backfilled instead (only when there are no
    // models at all; a default_project already configured via the CLI is left
    // as-is).
    await this.deps.projectConfig.ensurePresetModels(projectId);
    this.deps.projects.insert({
      projectId,
      ownerUserId: user.userId,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Delete a Project (owner): default_project is refused; deleting the user's
   * **last accessible Project** is refused too (deleting it would leave the list
   * empty, with no Project to select in the Web client and the page stuck on a
   * skeleton screen — a typical case being a non-first user deleting the initial
   * Project provisioned at signup); active runs are drained first, then the DB and
   * directory are cleared.
   */
  async deleteProject(userId: string, projectId: string): Promise<void> {
    this.requireProjectOwner(userId, projectId);
    if (projectId === DEFAULT_PROJECT_ID) {
      throw new HttpError(
        409,
        "cannot_delete_default_project",
        "default_project is shared with the CLI and cannot be deleted from the web.",
      );
    }
    if (this.deps.projects.listAccessible(userId).length <= 1) {
      throw new HttpError(
        409,
        "cannot_delete_last_project",
        "This is the account's last Project; deleting it would leave no Project available. Create a new Project first.",
      );
    }
    await this.destroyProject(projectId);
  }

  /**
   * The actual deletion (no authorization or protection checks): shared by
   * deleteProject and the cascade cleanup when an admin deletes a user.
   * Abort follow-up (writing the abort event to Trace, etc.) happens
   * asynchronously: waits for runs to settle (capped at 5s) before deleting the
   * directory, to avoid the Trace writer recreating the directory after deletion.
   */
  async destroyProject(projectId: string): Promise<void> {
    const runnings = this.deps.manager.abortProject(projectId);
    if (runnings.length > 0) {
      await Promise.race([
        Promise.allSettled(runnings).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, ABORT_SETTLE_TIMEOUT_MS).unref?.()),
      ]);
    }
    this.deps.projects.delete(projectId); // project_members cascade-deleted
    this.deps.agents.deleteByProject(projectId);
    this.deps.sessions.deleteByProject(projectId);
    this.deps.usage.deleteByProject(projectId);
    this.deps.errors.deleteByProject(projectId);
    this.deps.schedules.deleteByProject(projectId);
    await fs.rm(projectDir(this.deps.root, projectId), { recursive: true, force: true });
  }

  // —— Member authorization ——

  /** Member list: owner (role=owner) + members. */
  listMembers(userId: string, projectId: string): MemberInfo[] {
    const project = this.requireProjectAccess(userId, projectId);
    const members = this.deps.members.list(projectId);
    return [
      { userId: project.ownerUserId, role: "owner", createdAt: project.createdAt },
      ...members.map((m) => ({
        userId: m.userId,
        role: "member" as const,
        createdAt: m.createdAt,
      })),
    ];
  }

  /** Grant member access (owner): invites by username; 404 if the user doesn't exist, 409 for the owner themself or an existing member. */
  addMember(userId: string, projectId: string, targetUserId: string): MemberInfo {
    const project = this.requireProjectOwner(userId, projectId);
    const target = this.deps.users.findById(targetUserId);
    if (!target) {
      throw new HttpError(404, "user_not_found", `User does not exist: ${targetUserId}.`);
    }
    if (target.userId === project.ownerUserId) {
      throw new HttpError(
        409,
        "already_owner",
        "The owner does not need to grant access to themselves.",
      );
    }
    if (this.deps.members.isMember(projectId, target.userId)) {
      throw new HttpError(
        409,
        "already_member",
        `${targetUserId} is already a member of this Project.`,
      );
    }
    const createdAt = new Date().toISOString();
    this.deps.members.insert({ projectId, userId: target.userId, createdAt });
    return { userId: target.userId, role: "member", createdAt };
  }

  /** Revoke member access (owner). */
  removeMember(userId: string, projectId: string, targetUserId: string): void {
    this.requireProjectOwner(userId, projectId);
    if (!this.deps.members.isMember(projectId, targetUserId)) {
      throw new HttpError(404, "member_not_found", `This Project has no member: ${targetUserId}.`);
    }
    this.deps.members.delete(projectId, targetUserId);
  }

  /**
   * Ensures the Project's built-in Agent exists (the sole built-in Agent
   * default_agent; initialized if the directory is empty, otherwise loaded without
   * overwriting) and indexes it. createdAt increments by 1ms in preset order, so
   * built-in Agents stably sort first; other Agents backfilled by directory
   * scanning are sorted by their own createdAt and are outside the scope of this
   * guarantee.
   */
  private async provisionBuiltinAgents(projectId: string): Promise<void> {
    const agentIds = await provisionProjectAgents({ root: this.deps.root, projectId });
    const base = Date.now();
    agentIds.forEach((agentId, i) => {
      this.deps.agents.insertOrIgnore({
        projectId,
        agentId,
        createdAt: new Date(base + i).toISOString(),
      });
    });
  }
}

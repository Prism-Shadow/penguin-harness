/**
 * Admin user backend: user list / create / reset password / delete.
 *
 * - Create: username is the user_id (^[a-z][a-z0-9_-]{1,31}$); admin sets the initial
 *   password, flagged with password_is_initial; a default Project `proj-<username>` is
 *   auto-created, rolling back the user row on failure.
 * - Reset password: also flags the password as initial and clears all of the user's
 *   login sessions (forcing re-login).
 * - Delete: the built-in admin cannot be deleted; Projects owned by the user are
 *   deleted along with it (including data directories), with sessions/memberships/UI
 *   preferences cascade-deleted via foreign keys.
 */
import type { UserInfo } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { MIN_PASSWORD_LENGTH, toUserInfo } from "../auth/service.js";
import { hashPassword } from "../auth/password.js";
import type { AuthSessionsRepo } from "../db/repos/auth-sessions.js";
import type { ProjectsRepo } from "../db/repos/projects.js";
import type { UserRow, UsersRepo } from "../db/repos/users.js";
import { SEMANTIC_ID_RULE, USERNAME_PATTERN } from "./ids.js";
import type { ProjectService } from "./project-service.js";

export interface AdminServiceDeps {
  users: UsersRepo;
  authSessions: AuthSessionsRepo;
  projects: ProjectsRepo;
  projectService: ProjectService;
  now?: () => Date;
}

export class AdminService {
  private readonly now: () => Date;

  constructor(private readonly deps: AdminServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  listUsers(): UserInfo[] {
    return this.deps.users.list().map(toUserInfo);
  }

  async createUser(userId: string, password: string): Promise<UserInfo> {
    if (!USERNAME_PATTERN.test(userId)) {
      throw new HttpError(
        400,
        "invalid_user_id",
        `Username must be 2–32 characters: ${SEMANTIC_ID_RULE}.`,
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    if (this.deps.users.findById(userId)) {
      throw new HttpError(409, "user_exists", `User already exists: ${userId}.`);
    }
    const user: UserRow = {
      userId,
      passwordHash: await hashPassword(password),
      isAdmin: false,
      passwordIsInitial: true,
      createdAt: this.now().toISOString(),
    };
    this.deps.users.insert(user);
    try {
      await this.deps.projectService.provisionInitialProject(user, false);
    } catch (err) {
      // Compensation: roll back the user row if default Project creation fails (e.g. proj-<username> already taken).
      this.deps.users.delete(user.userId);
      throw err;
    }
    return toUserInfo(user);
  }

  /** Reset another user's password: flags it as initial and clears all their sessions (prompts a password change on next login). */
  async resetPassword(userId: string, password: string): Promise<void> {
    if (!this.deps.users.findById(userId)) {
      throw new HttpError(404, "user_not_found", `User does not exist: ${userId}.`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    this.deps.users.updatePassword(userId, await hashPassword(password), true);
    this.deps.authSessions.deleteByUser(userId);
  }

  /** Delete user: the built-in admin cannot be deleted; owned Projects (including data directories) are deleted along with it. */
  async deleteUser(userId: string): Promise<void> {
    const target = this.deps.users.findById(userId);
    if (!target) {
      throw new HttpError(404, "user_not_found", `User does not exist: ${userId}.`);
    }
    if (target.isAdmin) {
      throw new HttpError(409, "cannot_delete_admin", "The built-in admin cannot be deleted.");
    }
    for (const project of this.deps.projects.listByOwner(userId)) {
      await this.deps.projectService.destroyProject(project.projectId);
    }
    this.deps.users.delete(userId); // auth_sessions / project_members / ui_prefs cascade-deleted
  }
}

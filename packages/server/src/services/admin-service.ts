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
import { ADMIN_USER_ID, MIN_PASSWORD_LENGTH, toUserInfo } from "../auth/service.js";
import type { PasswordHasher } from "../auth/password.js";
import type { UserRow } from "../db/repos/users.js";
import { SEMANTIC_ID_RULE, USERNAME_PATTERN } from "./ids.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock } from "../hmr/capabilities.js";
import type { Admin, AuthSessions, Users } from "../mechanisms/identity.js";
import type { ProjectLifecycle, Projects } from "../mechanisms/projects.js";

@Component()
export class AdminService implements Admin {
  @Use() private readonly users!: Users;
  @Use() private readonly authSessions!: AuthSessions;
  @Use() private readonly projects!: Projects;
  @Use() private readonly projectService!: ProjectLifecycle;
  @Use() private readonly clock!: Clock;
  @Use() private readonly hasher!: PasswordHasher;

  listUsers(): UserInfo[] {
    return this.users.list().map(toUserInfo);
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
    if (this.users.findById(userId)) {
      throw new HttpError(409, "user_exists", `User already exists: ${userId}.`);
    }
    const user: UserRow = {
      userId,
      passwordHash: await this.hasher.hash(password),
      isAdmin: false,
      passwordIsInitial: true,
      createdAt: this.clock.now().toISOString(),
    };
    this.users.insert(user);
    try {
      await this.projectService.provisionInitialProject(user, false);
    } catch (err) {
      // Compensation: roll back the user row if default Project creation fails (e.g. proj-<username> already taken).
      this.users.delete(user.userId);
      throw err;
    }
    return toUserInfo(user);
  }

  /**
   * Reset a user's password and clear all their sessions (prompts a password change on next
   * login). Only an admin reaches this route, so `userId === admin` is the admin resetting
   * ITSELF: it chose a KNOWN password, which is a claimed state — not the unclaimed one the
   * first-login link exists for — so the initial flag stays off and no link is re-opened.
   * Every other user gets the flag, to be prompted to change the password their admin picked.
   */
  async resetPassword(userId: string, password: string): Promise<void> {
    if (!this.users.findById(userId)) {
      throw new HttpError(404, "user_not_found", `User does not exist: ${userId}.`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, "invalid_password", "Password must be at least 8 characters.");
    }
    const isSelfAdminReset = userId === ADMIN_USER_ID;
    this.users.updatePassword(userId, await this.hasher.hash(password), !isSelfAdminReset);
    // Force re-login: delete every session row for this user.
    this.authSessions.deleteByUser(userId);
  }

  /** Delete user: the built-in admin cannot be deleted; owned Projects (including data directories) are deleted along with it. */
  async deleteUser(userId: string): Promise<void> {
    const target = this.users.findById(userId);
    if (!target) {
      throw new HttpError(404, "user_not_found", `User does not exist: ${userId}.`);
    }
    if (target.isAdmin) {
      throw new HttpError(409, "cannot_delete_admin", "The built-in admin cannot be deleted.");
    }
    for (const project of this.projects.listByOwner(userId)) {
      await this.projectService.destroyProject(project.projectId);
    }
    this.users.delete(userId); // project_members / ui_prefs cascade-deleted
  }
}

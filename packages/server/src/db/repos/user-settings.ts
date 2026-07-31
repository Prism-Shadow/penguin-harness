/** Per-user settings. */
import type { DatabaseSync } from "node:sqlite";
import type { ApprovalMode } from "../../api/types.js";

const DEFAULT_APPROVAL_MODE: ApprovalMode = "allow-all";

export class UserSettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  getApprovalMode(userId: string): ApprovalMode {
    const row = this.db
      .prepare("SELECT approval_mode FROM user_settings WHERE user_id = ?")
      .get(userId) as { approval_mode?: unknown } | undefined;
    return typeof row?.approval_mode === "string"
      ? (row.approval_mode as ApprovalMode)
      : DEFAULT_APPROVAL_MODE;
  }

  setApprovalMode(userId: string, approvalMode: ApprovalMode): void {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, approval_mode) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET approval_mode = excluded.approval_mode`,
      )
      .run(userId, approvalMode);
  }
}

/** Per-user approval mode. */
import type { ApprovalMode } from "../api/types.js";
import type { UserSettingsRepo } from "../db/repos/user-settings.js";

export interface ApprovalModeServiceDeps {
  settings: UserSettingsRepo;
  notify: (userId: string, approvalMode: ApprovalMode) => void;
}

export class ApprovalModeService {
  constructor(private readonly deps: ApprovalModeServiceDeps) {}

  get(userId: string): ApprovalMode {
    return this.deps.settings.getApprovalMode(userId);
  }

  set(userId: string, approvalMode: ApprovalMode): void {
    this.deps.settings.setApprovalMode(userId, approvalMode);
    this.deps.notify(userId, approvalMode);
  }
}

/**
 * System-wide approval mode.
 *
 * The system setting is authoritative for runtime checks. Session rows retain a denormalized
 * snapshot for API compatibility and are updated together whenever the mode changes.
 */
import type { ApprovalMode } from "../api/types.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { SystemSettingsRepo } from "../db/repos/system-settings.js";

const SETTING_KEY = "approval_mode";
const DEFAULT_MODE: ApprovalMode = "allow-all";
const APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

export interface ApprovalModeServiceDeps {
  settings: SystemSettingsRepo;
  sessions: SessionsRepo;
  notify: (approvalMode: ApprovalMode) => void;
}

export class ApprovalModeService {
  constructor(private readonly deps: ApprovalModeServiceDeps) {}

  get(): ApprovalMode {
    const stored = this.deps.settings.get(SETTING_KEY);
    return APPROVAL_MODES.includes(stored as ApprovalMode)
      ? (stored as ApprovalMode)
      : DEFAULT_MODE;
  }

  set(approvalMode: ApprovalMode): void {
    this.deps.settings.set(SETTING_KEY, approvalMode);
    this.deps.sessions.updateAllApprovalModes(approvalMode);
    this.deps.notify(approvalMode);
  }

  /** Startup convergence for Session rows created before the system-wide setting existed. */
  synchronizeSessions(): void {
    this.deps.sessions.updateAllApprovalModes(this.get());
  }
}

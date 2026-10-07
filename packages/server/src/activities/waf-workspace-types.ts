/**
 * The WAF workspace as the App sees it: its settings and its state. Types only, so the web
 * can import them; the service is waf-workspace.ts.
 */

/** The shared repositories every activity needs; product modules are cloned on demand. */
export type WafRepoId = "framework" | "navbar" | "media" | "activityData";

export interface WafRepoSetting {
  remote: string;
  branch: string;
}

export interface WafWorkspaceSettings {
  /** An existing checkout Penguin reads instead of managing its own; empty when managed. */
  externalRoot: string;
  repos: Record<WafRepoId, WafRepoSetting>;
  /** The remote of a product's module; `{module}` is replaced by its folder. */
  moduleRemote: string;
}

export interface WafRepoStatus {
  id: WafRepoId;
  path: string;
  present: boolean;
  /** Origin's address; null when there is no clone or it has no origin. */
  remote: string | null;
  /** Whether origin is the configured remote; always true for an existing checkout. */
  remoteMatches: boolean;
  branch: string | null;
  /** Whether it is on the configured branch; always true for an existing checkout. */
  branchMatches: boolean;
  /** Whether the working tree has changes; null when git could not say. */
  dirty: boolean | null;
  /** Whether its dependencies are installed; null for a repository that needs none. */
  installed: boolean | null;
}

export interface WafWorkspaceStatus {
  /** False when an admin (or WAF_ROOT_DIR) named an existing checkout. */
  managed: boolean;
  root: string;
  /** Whether authoring, the sandbox and deploys can use the workspace now. */
  ready: boolean;
  repos: WafRepoStatus[];
  preparing: boolean;
  /** Why the latest preparation failed; null when it did not. */
  lastError: string | null;
  log: string[];
}

/** GET /api/admin/waf-workspace and POST .../prepare. */
export interface WafWorkspaceStatusResponse {
  status: WafWorkspaceStatus;
}

/** GET and PUT /api/admin/waf-workspace/settings. */
export interface WafWorkspaceSettingsResponse {
  settings: WafWorkspaceSettings;
}

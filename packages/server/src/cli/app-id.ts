/**
 * Canonical App identifier resolution for the CLI: `<agentId>/<workbenchId>`.
 *
 * A canonical App ID always contains a single `/` separating the owning Agent's ID from the
 * workbench folder ID, making it syntactically disjoint from `sessionId`
 * (`session-YYYY-MM-DD-HH-MM-SS-<8hex>`, which never contains `/`).
 *
 * Resolution rules:
 * - Explicit `<agentId>/<workbenchId>` argument (validated on both sides; fails fast if a
 *   conflicting `--agent-id` flag was also passed).
 * - Bare `<workbenchId>` shorthand when `--agent-id` or `PENGUIN_AGENT_ID` supplies the Agent.
 * - Omitted argument falls back to `PENGUIN_APP_ID` (injected into workbench Sessions' env).
 * - Anything matching `sessionId` is rejected with a dedicated hint rather than treated as a
 *   bare workbench name.
 */
import { isValidId } from "@prismshadow/penguin-core";
import { isWorkbenchId } from "@prismshadow/penguin-library-agent/agent-vocab";

/** Mirrors `SESSION_ID_RE` in `@prismshadow/penguin-library-cli` to catch accidental sessionId reuse. */
const SESSION_ID_RE = /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

export interface ResolvedAppId {
  readonly agentId: string;
  readonly workbenchId: string;
  /** Canonical `<agentId>/<workbenchId>`. */
  readonly appId: string;
}

export type AppIdError =
  | { readonly kind: "missing" }
  | { readonly kind: "looks_like_session_id"; readonly raw: string }
  | { readonly kind: "invalid"; readonly raw: string }
  | { readonly kind: "missing_agent"; readonly workbenchId: string }
  | {
      readonly kind: "agent_mismatch";
      readonly appAgentId: string;
      readonly flagAgentId: string;
    };

export type AppIdResult =
  ({ readonly ok: true } & ResolvedAppId) | ({ readonly ok: false } & AppIdError);

/** Canonical `<agentId>/<workbenchId>` key. */
export function formatAppId(agentId: string, workbenchId: string): string {
  return `${agentId}/${workbenchId}`;
}

/**
 * Resolves an App ID from an explicit CLI argument or (when `allowEnv` is true) `PENGUIN_APP_ID`.
 * When `raw` is a bare `<workbenchId>`, `agentId` comes from `opts.agentId` or `PENGUIN_AGENT_ID`.
 */
export function resolveAppId(
  raw: string | undefined,
  opts: {
    agentId?: string;
    allowEnv?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): AppIdResult {
  const env = opts.env ?? process.env;
  const trimmed = raw?.trim() || (opts.allowEnv !== false ? env.PENGUIN_APP_ID?.trim() : "") || "";
  if (!trimmed) return { ok: false, kind: "missing" };

  if (SESSION_ID_RE.test(trimmed)) {
    return { ok: false, kind: "looks_like_session_id", raw: trimmed };
  }

  const flagAgentId = opts.agentId?.trim() || undefined;

  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length !== 2) return { ok: false, kind: "invalid", raw: trimmed };
    const [agentId, workbenchId] = parts as [string, string];
    if (!isValidId(agentId) || !isWorkbenchId(workbenchId)) {
      return { ok: false, kind: "invalid", raw: trimmed };
    }
    if (flagAgentId !== undefined && flagAgentId !== agentId) {
      return { ok: false, kind: "agent_mismatch", appAgentId: agentId, flagAgentId };
    }
    return { ok: true, agentId, workbenchId, appId: formatAppId(agentId, workbenchId) };
  }

  if (!isWorkbenchId(trimmed)) {
    return { ok: false, kind: "invalid", raw: trimmed };
  }
  const agentId = flagAgentId ?? env.PENGUIN_AGENT_ID?.trim();
  if (!agentId) return { ok: false, kind: "missing_agent", workbenchId: trimmed };
  if (!isValidId(agentId)) {
    return { ok: false, kind: "invalid", raw: `${agentId}/${trimmed}` };
  }
  return { ok: true, agentId, workbenchId: trimmed, appId: formatAppId(agentId, trimmed) };
}

/**
 * Validates a workbench API sub-path for `penguin app call`.
 * Must start with `/` (never `//`), and its path segments must not contain `.`, `..`, or `\\`
 * (raw or percent-encoded) so URL normalization cannot escape `/workbenches/:id/api`.
 */
export function validateAppApiPath(raw: string): string | null {
  const value = raw.trim();
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("#") ||
    /[\x00-\x1f\x7f\s]/.test(value)
  ) {
    return null;
  }
  const queryStart = value.indexOf("?");
  const pathname = queryStart === -1 ? value : value.slice(0, queryStart);
  if (pathname.includes("\\")) return null;
  for (const segment of pathname.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      return null;
    }
  }
  return value;
}

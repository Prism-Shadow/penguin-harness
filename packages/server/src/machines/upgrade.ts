/**
 * Sending THIS server's hot-pushed build to a machine, and applying it there.
 *
 * The same three artifacts the local server was pushed — platform, cli, web (plus any native
 * assets) — are re-packed into the body `/api/hmr/upgrade` takes and POSTed to the machine's
 * OWN copy of that endpoint, through the connection this side holds to it. What the far side
 * answers is the endpoint's own JSON, with its own error codes, exactly as the local push
 * reads it.
 *
 * The result is a hot swap: seconds, no restart, and nothing that machine was running dies.
 * That is the difference between this and reinstalling, which replaces the program on disk
 * and needs the server bounced to take effect.
 */
import http from "node:http";
import { machineApi } from "./machine-api.js";
import { readPushedBuild } from "../hmr/pushed-build.js";

// The body a hand-over forwards is read by the same helper the harness history keeps its
// rollback copies with; re-exported so this module stays the machines' one import for it.
export { readPushedBuild };

/** Long enough for 8 MB over a slow link, plus the unpack, boot and commit on the far side. */
const APPLY_TIMEOUT_MS = 10 * 60_000;

export type UpgradeOutcome =
  /**
   * The machine took the build and is running it. `persisted` is its own word on whether the
   * version was also written to its disk: false means live now and gone at its next restart
   * (host.ts's persistVersion), which is not the same fact as upgraded, and is not recorded
   * as one.
   */
  | { kind: "upgraded"; detail: string; persisted: boolean }
  /** The machine answered, and said no — a refused body, a runtime that cannot take it. */
  | { kind: "refused"; detail: string }
  /** Nothing to send: this server has never been pushed to. */
  | { kind: "no-build" }
  /**
   * Nothing to update: no server is running over there. A hot swap replaces the code a
   * RUNNING server is serving, so this is not a failure — whatever is on its disk is what it
   * will load when it next starts.
   */
  | { kind: "no-server" }
  /** Could not reach it, or it never answered; `detail` is its own words where there are any. */
  | { kind: "failed"; step: string; detail: string };

/** The machine's own words for a refusal: the API error envelope's message, else the text. */
export function refusalDetail(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    const message = body.error?.message;
    if (typeof message === "string" && message !== "") return message;
  } catch {
    // Not the API's error envelope; the text itself is the best there is.
  }
  const said = text.trim();
  return said === "" ? `it refused with ${status} and said nothing` : said;
}

/** Applies this server's build on the machine reachable at `port`. Never throws. */
export async function upgradeRemote(opts: {
  /** A dial through the machine's connection, and its server's port over there. */
  agent: http.Agent;
  port: number;
  /** A session on that machine, as its own cookie (`penguin_session=…`). */
  cookie: string;
  dataRoot: string;
  onProgress?: (line: string) => void;
}): Promise<UpgradeOutcome> {
  const payload = readPushedBuild(opts.dataRoot);
  if (payload === null) return { kind: "no-build" };
  opts.onProgress?.(`Sending this build (${(payload.byteLength / 1048576).toFixed(1)} MB)…`);
  let answer: { status: number; text: string };
  try {
    answer = await machineApi(opts.agent, opts.port, opts.cookie).postBytes(
      "/api/hmr/upgrade",
      "application/gzip",
      payload,
      APPLY_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      kind: "failed",
      step: "apply",
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
    };
  }
  return classifyUpgradeAnswer(answer.status, answer.text);
}

/**
 * What the endpoint's answer means. A refusal is an ANSWER: the machine was reached and said
 * no, which is not the same as failing to reach it, and the page offers different things for
 * the two. And a 2xx is not yet a yes: `/api/hmr/upgrade` answers 200 for `blocked` — the
 * running version kept serving, the body names what would have been discarded — so clients
 * keep one parsing path (hmr/routes.ts), and scripts/deploy.mjs reads it the same way.
 */
export function classifyUpgradeAnswer(status: number, text: string): UpgradeOutcome {
  if (status < 200 || status >= 300) {
    return { kind: "refused", detail: refusalDetail(status, text).slice(0, 400) };
  }
  let body: {
    status?: unknown;
    persisted?: unknown;
    dropped?: unknown;
    missing?: unknown;
    invalid?: unknown;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return {
      kind: "refused",
      detail: `it answered ${status} with something that is not its outcome: ${text.trim().slice(0, 200)}`,
    };
  }
  if (body.status === "blocked") {
    const names = (key: "dropped" | "missing" | "invalid") =>
      Array.isArray(body[key]) && body[key].length > 0
        ? `${key}: ${(body[key] as string[]).join(", ")}`
        : null;
    const why = [names("missing"), names("invalid"), names("dropped")]
      .filter((s) => s !== null)
      .join("; ");
    return {
      kind: "refused",
      detail: `it kept its current version${why === "" ? "" : ` — ${why}`}`.slice(0, 400),
    };
  }
  if (body.status !== "ok") {
    return {
      kind: "refused",
      detail: `it answered ${status} with an outcome this build does not know: ${text.trim().slice(0, 200)}`,
    };
  }
  return {
    kind: "upgraded",
    detail: text.trim().slice(0, 400),
    persisted: body.persisted !== false,
  };
}

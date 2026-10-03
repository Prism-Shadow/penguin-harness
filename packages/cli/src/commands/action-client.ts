/**
 * Running an Action from the CLI: every write to an organization's proposals and roadmaps is
 * an Action of company-proposals' registry, run with `POST …/actions/<key>/runs` (or
 * `…/actions/by-id/<contribution>/runs` for one contribution exactly). The body is the
 * subject, the parameters, `via: "cli"` and the caller's identity claims; the answer is the run
 * and its result — what the write answers, the proposal after it — or, for a run that started
 * a process (a deploy), the run alone while the process goes on, followed with
 * `GET …/actions/runs/<id>?from=`.
 */
import type {
  ActionRunAnswer,
  ActionRunResponse,
  ActionRunView,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "../client.js";
import type { Messages } from "../i18n.js";

/** A request under the organization's `…/actions` routes; null after an error it reported. */
export type ActionRequester = <T>(
  method: string,
  suffix: string,
  body?: unknown,
) => Promise<T | null>;

/**
 * The requester of the organization's `…/actions` routes: a 404 carrying no known code is a
 * missing plugin, said as such; an ambiguous key's refusal also lists the exact invocation of
 * each contribution answering it. Both answer null after the report; anything else is thrown.
 */
export function actionRequester(
  client: { request<T>(method: string, path: string, body?: unknown): Promise<T> },
  /** `…/organizations/<orgId>`. */
  orgBase: string,
  /** The 404 codes a route of the organization answers; any other 404 is no route at all. */
  known404: ReadonlySet<string>,
  t: Messages,
  fail: (message: string) => void,
): ActionRequester {
  return async <T>(method: string, suffix: string, body?: unknown): Promise<T | null> => {
    try {
      return await client.request<T>(method, `${orgBase}/actions${suffix}`, body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && !known404.has(err.code)) {
        fail(t.org.proposalsPluginMissing());
        return null;
      }
      if (err instanceof ApiError && err.code === "action_ambiguous") {
        const forms = (err.body as { error?: { contributions?: Array<{ cli?: unknown }> } } | null)
          ?.error?.contributions;
        fail(err.message);
        for (const f of forms ?? []) {
          if (typeof f.cli === "string") process.stderr.write(`${t.org.actionExecForm(f.cli)}\n`);
        }
        return null;
      }
      throw err;
    }
  };
}

/** Which Action a run names: by key, or one contribution exactly. */
export type ActionTarget = { key: string } | { contribution: string };

export function runPath(target: ActionTarget): string {
  return "key" in target
    ? `/${encodeURIComponent(target.key)}/runs`
    : `/by-id/${encodeURIComponent(target.contribution)}/runs`;
}

/** Starts a run; the answer as the server gave it, or null after an error it reported. */
export function startRun(
  request: ActionRequester,
  target: ActionTarget,
  subject: string,
  params: Record<string, unknown>,
  actor: Record<string, string>,
  extra: { requestId?: string } = {},
): Promise<ActionRunAnswer | null> {
  return request<ActionRunAnswer>("POST", runPath(target), {
    subject,
    params,
    via: "cli",
    ...(extra.requestId !== undefined ? { requestId: extra.requestId } : {}),
    ...actor,
  });
}

/** Runs Action `key` and answers its result (what the write answers), or null after an error. */
export async function runAction<T>(
  request: ActionRequester,
  key: string,
  subject: string,
  params: Record<string, unknown>,
  actor: Record<string, string>,
): Promise<T | null> {
  const answer = await startRun(request, { key }, subject, params, actor);
  return answer === null ? null : (answer.result as T);
}

/** How often a followed run is asked for more output. */
export const FOLLOW_INTERVAL_MS = 1000;

/** Follows a run until it ends, writing its output as it arrives; the run as it ended, or null after an error it reported. */
export async function followRun(
  request: ActionRequester,
  runId: string,
  kit: {
    actorQuery(): string;
    write(text: string): void;
    sleep(ms: number): Promise<void>;
  },
): Promise<ActionRunView | null> {
  let from = 0;
  const actor = kit.actorQuery();
  const query = actor === "" ? "?" : `${actor}&`;
  for (;;) {
    const res = await request<ActionRunResponse>(
      "GET",
      `/runs/${encodeURIComponent(runId)}${query}from=${from}`,
    );
    if (res === null) return null;
    if (res.output !== "") kit.write(res.output);
    from = res.next;
    if (res.run.outcome !== null) return res.run;
    await kit.sleep(FOLLOW_INTERVAL_MS);
  }
}

/** The exit code a run that did not succeed ends the command with: its process's, else 1. */
export function exitCodeOf(run: ActionRunView): number {
  if (run.outcome === "succeeded") return 0;
  const code = (run.result as { exitCode?: unknown } | null)?.exitCode;
  return typeof code === "number" && code !== 0 ? code : 1;
}

/**
 * `--param name=value` flags and a `--params '<json>'` object, merged (the flags win). A value
 * is taken as JSON when it parses as JSON, else as the string it is. Null for a malformed flag
 * or object, with the reason.
 */
export function parseParams(
  flags: readonly string[],
  json: string | undefined,
): { params: Record<string, unknown> } | { error: string } {
  let params: Record<string, unknown> = {};
  if (json !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { error: json };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: json };
    }
    params = { ...(parsed as Record<string, unknown>) };
  }
  for (const flag of flags) {
    const at = flag.indexOf("=");
    if (at <= 0) return { error: flag };
    const name = flag.slice(0, at);
    const raw = flag.slice(at + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not JSON: the string as given.
    }
    params[name] = value;
  }
  return { params };
}

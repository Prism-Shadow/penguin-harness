/**
 * Jenkins for deploys: start a parameterised job, and find how the build it started is doing.
 *
 * A build is found by its parameters, the way the job was started: first among the queued
 * items, then among the job's builds, newest first. Builds numbered at or below `after` are
 * the ones that were there before the trigger and are passed over, so an older build with the
 * same parameters is never taken for the new one.
 *
 * Requests carry Basic auth and never follow a redirect, so the credentials go only to the
 * configured Jenkins. A 403 that names the crumb or CSRF is retried once with a crumb from
 * `crumbIssuer/api/json`. No error, log line or returned value contains the token: errors carry
 * only the HTTP status.
 *
 * Every request goes through a `JenkinsFetch`, which a test replaces with a fake.
 */

/** How long one Jenkins request may take. */
export const JENKINS_REQUEST_TIMEOUT_MS = 15_000;

/** A Jenkins request, as `fetch` takes it. */
export interface JenkinsRequestInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface JenkinsResponseHeaders {
  get(name: string): string | null;
}

/** What a Jenkins answer needs to offer, as `fetch`'s Response does. */
export interface JenkinsResponse {
  status: number;
  headers: JenkinsResponseHeaders;
  text(): Promise<string>;
}

/** What a Jenkins request needs from `fetch`, so a test can answer it. */
export type JenkinsFetch = (url: string, init: JenkinsRequestInit) => Promise<JenkinsResponse>;

/** Which Jenkins, and who it is asked as. */
export interface JenkinsTarget {
  url: string;
  username: string;
  token: string;
}

export type JenkinsBuildState = "queued" | "building" | "succeeded" | "failed" | "unknown";

export interface JenkinsBuildStatus {
  state: JenkinsBuildState;
  /** The build's (or queue item's) page. */
  url?: string;
  /** The build's number, once it has left the queue. */
  number?: number;
  /** Jenkins's own word for how it ended (FAILURE, ABORTED, …), when it ended badly. */
  result?: string;
}

/** A Jenkins request that failed; `status` is the HTTP status, 0 when nothing answered. */
export class JenkinsError extends Error {
  constructor(readonly status: number) {
    super(status ? `Jenkins answered HTTP ${status}.` : "Jenkins did not answer.");
    this.name = "JenkinsError";
  }
}

/** Starting a job and following the build it started. */
export interface DeployJenkins {
  trigger(job: string, params: Record<string, string>): Promise<{ queueUrl: string | null }>;
  status(
    job: string,
    params: Record<string, string>,
    options?: { after?: number | null },
  ): Promise<JenkinsBuildStatus>;
}

/** The real `fetch`, never following a redirect. */
export const fetchJenkins: JenkinsFetch = async (url, init) => {
  const response = await fetch(url, { ...init, redirect: "manual" });
  return response;
};

type Parameters = Array<{ name?: unknown; value?: unknown }>;
type Actions = Array<{ parameters?: Parameters } | null>;

/** Whether a queue item's or build's actions carry every one of `params`. */
export function carriesParameters(actions: unknown, params: Record<string, string>): boolean {
  if (!Array.isArray(actions)) return false;
  const found = new Map<string, string>();
  for (const action of actions as Actions) {
    const list = action && Array.isArray(action.parameters) ? action.parameters : [];
    for (const parameter of list)
      if (parameter && typeof parameter.name === "string")
        found.set(parameter.name, String(parameter.value ?? ""));
  }
  // A multi-line parameter (several modules in one build) carries a value on any of its lines.
  return Object.entries(params).every(([name, value]) => {
    const seen = found.get(name);
    return (
      seen !== undefined &&
      (seen === value || seen.split(/\r?\n/).some((line) => line.trim() === value))
    );
  });
}

/** How a finished build's result reads. */
function stateOf(build: { building?: unknown; result?: unknown }): JenkinsBuildStatus {
  if (build.building === true) return { state: "building" };
  const result = typeof build.result === "string" ? build.result.toUpperCase() : "";
  if (result === "SUCCESS") return { state: "succeeded" };
  if (result === "") return { state: "unknown" };
  return { state: "failed", result };
}

/** A Jenkins client over `request`, the real `fetch` unless a test hands in its own. */
export function createDeployJenkins(
  target: JenkinsTarget,
  request: JenkinsFetch = fetchJenkins,
  timeoutMs = JENKINS_REQUEST_TIMEOUT_MS,
): DeployJenkins {
  const base = target.url.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${target.username}:${target.token}`).toString("base64")}`;
  const jobPath = (job: string) => `${base}/job/${encodeURIComponent(job)}`;

  async function send(
    url: string,
    method: "GET" | "POST",
    extra: Record<string, string> = {},
    body?: string,
  ) {
    try {
      return await request(url, {
        method,
        headers: { Authorization: auth, Accept: "application/json", ...extra },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The underlying error may carry the request, and with it the header: none of it leaves.
      throw new JenkinsError(0);
    }
  }

  async function getJson(url: string): Promise<Record<string, unknown>> {
    const response = await send(url, "GET");
    if (response.status < 200 || response.status >= 300) throw new JenkinsError(response.status);
    try {
      const value = JSON.parse(await response.text()) as unknown;
      return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
      throw new JenkinsError(response.status);
    }
  }

  async function crumb(): Promise<Record<string, string> | null> {
    try {
      const value = await getJson(`${base}/crumbIssuer/api/json`);
      const field = typeof value.crumbRequestField === "string" ? value.crumbRequestField : "";
      const token = typeof value.crumb === "string" ? value.crumb : "";
      return field && token ? { [field]: token } : null;
    } catch {
      return null;
    }
  }

  /** A page Jenkins names, made absolute; only a web address is kept, since the App links it. */
  const absolute = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    try {
      const url = new URL(value.trim(), `${base}/`);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async trigger(job, params) {
      const url = `${jobPath(job)}/buildWithParameters`;
      const body = new URLSearchParams(params).toString();
      const form = { "Content-Type": "application/x-www-form-urlencoded" };
      let response = await send(url, "POST", form, body);
      if (response.status === 403) {
        const text = (await response.text().catch(() => "")).toLowerCase();
        if (text.includes("crumb") || text.includes("csrf")) {
          const header = await crumb();
          if (!header) throw new JenkinsError(403);
          response = await send(url, "POST", { ...form, ...header }, body);
        }
      }
      if (response.status < 200 || response.status >= 300) throw new JenkinsError(response.status);
      return { queueUrl: absolute(response.headers.get("location")) ?? null };
    },

    async status(job, params, options = {}) {
      const queue = await getJson(
        `${base}/queue/api/json?tree=items[url,why,actions[parameters[name,value]]]`,
      );
      const items = Array.isArray(queue.items) ? (queue.items as Record<string, unknown>[]) : [];
      const queued = items.find((item) => item && carriesParameters(item.actions, params));
      if (queued) {
        const url = absolute(queued.url);
        return { state: "queued", ...(url ? { url } : {}) };
      }
      const jobInfo = await getJson(
        `${jobPath(job)}/api/json?tree=builds[number,url,building,result,actions[parameters[name,value]]]`,
      );
      const builds = Array.isArray(jobInfo.builds)
        ? (jobInfo.builds as Record<string, unknown>[])
        : [];
      const after = options.after ?? null;
      const build = builds.find(
        (entry) =>
          entry &&
          typeof entry.number === "number" &&
          (after === null || entry.number > after) &&
          carriesParameters(entry.actions, params),
      );
      if (!build) return { state: "unknown" };
      const url = absolute(build.url);
      return {
        ...stateOf(build),
        number: build.number as number,
        ...(url ? { url } : {}),
      };
    },
  };
}

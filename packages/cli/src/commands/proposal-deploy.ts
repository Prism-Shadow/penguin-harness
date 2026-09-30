/**
 * `penguin org proposal deploy <n> --to <port|url>`: hot-update one penguin server to the
 * generation a proposal names — the head of its impl PR.
 *
 * Five steps, each stopping the run on failure:
 *
 *   1. resolve the proposal's impl PR (`GET …/proposals/<n>`);
 *   2. fetch `refs/pull/<n>/head` from the PR's repository into this checkout — GitHub keeps
 *      that ref on the base repository for every PR, a fork's included;
 *   3. install and build it in a throwaway `git worktree` and run THAT generation's own
 *      `scripts/deploy.mjs <target>` — how bundles are built and what `/api/hmr/upgrade`
 *      expects travel with the generation, so today's script must not build another one;
 *   4. read the target's `GET /api/version` and require its `harness.source.revision` to name
 *      the head (a refused or rolled-back push leaves the old revision there);
 *   5. remove the worktree, whatever happened.
 *
 * No credential is read or stored here. The caller's PENGUIN_ADMIN_PASSWORD or
 * PENGUIN_API_TOKEN — the two deploy.mjs accepts — reaches deploy.mjs through the inherited
 * environment and is used once more for the version read; it never appears in an argument or
 * a line of output. The build runs on the caller's machine, never on a server: a server that
 * pushes to other servers would have to hold their admin credentials at rest.
 *
 * The core (`deployProposal`) takes its process runner and HTTP read as parameters so the
 * whole sequence is testable without git, pnpm or a network.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";

/** What the core needs from the proposal: its number and the impl PR's URL (null when none is registered). */
export interface DeployProposal {
  number: number;
  implPrUrl: string | null;
}

export interface RunResult {
  code: number;
  stdout: string;
}

/** Runs one program. `capture` collects stdout (for git's answers); otherwise output streams to the terminal. */
export type Run = (
  command: string,
  args: string[],
  opts: { cwd: string; capture?: boolean },
) => Promise<RunResult>;

/** Reads the target's `GET /api/version` with the caller's credential; the revision, or null when it records none. */
export type ReadRevision = (baseUrl: string, env: NodeJS.ProcessEnv) => Promise<string | null>;

export interface DeployOptions {
  proposal: DeployProposal;
  /** `--to`: a bare port (this machine's loopback) or a full origin. */
  to: string;
  /** Where the command runs: inside a checkout of this repository, whose `.worktrees/` holds the build. */
  cwd: string;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  run: Run;
  readRevision: ReadRevision;
  /** The Node that runs the generation's deploy.mjs. */
  node: string;
  log: (line: string) => void;
}

export type DeployOutcome =
  | { ok: true; head: string; revision: string | null; dryRun: boolean }
  | { ok: false; reason: string };

const PULL_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The target as deploy.mjs spells it: a bare port is this machine's loopback. */
export function targetUrl(to: string): string {
  return /^\d+$/.test(to) ? `http://127.0.0.1:${to}` : to.replace(/\/+$/, "");
}

/** deploy.mjs's plaintext rule, checked before anything runs: http only to a loopback host. */
export function plaintextProblem(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `not a URL: ${baseUrl}`;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname.toLowerCase())) return null;
  return `refusing plaintext ${url.protocol}//${url.hostname}: use https://, or an ssh -L tunnel to a local port`;
}

/** `https://github.com/<owner>/<repo>/pull/<n>` → the repository's clone URL and the PR number. */
export function parseImplPr(url: string): { repoUrl: string; pull: number } | null {
  const m = PULL_URL.exec(url.trim());
  if (m === null) return null;
  return { repoUrl: `https://github.com/${m[1]}/${m[2]}.git`, pull: Number(m[3]) };
}

/** Whether a recorded revision (`git describe` form, or a bare sha) names this head. */
export function revisionNames(revision: string, head: string): boolean {
  const sha = /(?:^|-g)([0-9a-f]{7,40})(?:-dirty)?$/.exec(revision)?.[1];
  return sha !== undefined && head.startsWith(sha) && !revision.endsWith("-dirty");
}

export async function deployProposal(o: DeployOptions): Promise<DeployOutcome> {
  const n = o.proposal.number;
  if (o.proposal.implPrUrl === null) {
    return {
      ok: false,
      reason: `proposal #${n} has no impl PR; register one with \`penguin org proposal impl ${n} <url>\``,
    };
  }
  const pr = parseImplPr(o.proposal.implPrUrl);
  if (pr === null)
    return {
      ok: false,
      reason: `impl PR is not a GitHub pull request URL: ${o.proposal.implPrUrl}`,
    };
  const baseUrl = targetUrl(o.to);
  const unsafe = plaintextProblem(baseUrl);
  if (unsafe !== null) return { ok: false, reason: unsafe };
  if (!o.dryRun && !o.env.PENGUIN_ADMIN_PASSWORD && !o.env.PENGUIN_API_TOKEN) {
    return { ok: false, reason: "set PENGUIN_ADMIN_PASSWORD or PENGUIN_API_TOKEN for the target" };
  }

  const top = await o.run("git", ["-C", o.cwd, "rev-parse", "--show-toplevel"], {
    cwd: o.cwd,
    capture: true,
  });
  if (top.code !== 0) return { ok: false, reason: `not inside a git checkout: ${o.cwd}` };
  const repoDir = top.stdout.trim();
  const git = (args: string[], capture = false): Promise<RunResult> =>
    o.run("git", ["-C", repoDir, ...args], { cwd: repoDir, capture });
  // Into FETCH_HEAD only: the run leaves no ref behind in the caller's checkout.
  if ((await git(["fetch", "--no-tags", pr.repoUrl, `refs/pull/${pr.pull}/head`])).code !== 0) {
    return { ok: false, reason: `could not fetch refs/pull/${pr.pull}/head from ${pr.repoUrl}` };
  }
  const parsed = await git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], true);
  const head = parsed.stdout.trim();
  if (parsed.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) {
    return { ok: false, reason: `refs/pull/${pr.pull}/head did not fetch as a commit` };
  }
  o.log(`proposal #${n} → ${o.proposal.implPrUrl} @ ${head} → ${baseUrl}`);
  if (o.dryRun) return { ok: true, head, revision: null, dryRun: true };

  const tree = path.join(repoDir, ".worktrees", `deploy-${head.slice(0, 12)}`);
  if ((await git(["worktree", "add", "--detach", tree, head])).code !== 0) {
    return {
      ok: false,
      reason: `could not create the worktree ${tree} (is one left from an earlier run?)`,
    };
  }
  try {
    if ((await o.run("pnpm", ["install", "--frozen-lockfile"], { cwd: tree })).code !== 0) {
      return { ok: false, reason: "pnpm install --frozen-lockfile failed in the worktree" };
    }
    // deploy.mjs builds the web dist and bundles platform and cli only; the workspace
    // packages they import must already be built.
    if ((await o.run("pnpm", ["-r", "build"], { cwd: tree })).code !== 0) {
      return { ok: false, reason: "pnpm -r build failed in the worktree" };
    }
    if ((await o.run(o.node, ["scripts/deploy.mjs", o.to], { cwd: tree })).code !== 0) {
      return {
        ok: false,
        reason: "the generation's scripts/deploy.mjs failed; the target keeps its version",
      };
    }
  } finally {
    await git(["worktree", "remove", "--force", tree]);
  }

  const revision = await o.readRevision(baseUrl, o.env);
  if (revision === null || !revisionNames(revision, head)) {
    return {
      ok: false,
      reason: `the target reports ${revision ?? "no revision"}, expected ${head}`,
    };
  }
  return { ok: true, head, revision, dryRun: false };
}

// ---------------------------------------------------------------------------
// The real runner and version read
// ---------------------------------------------------------------------------

export const spawnRun: Run = (command, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: opts.capture === true ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", () => resolve({ code: -1, stdout: "" }));
    child.on("close", (code) =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks).toString("utf8") }),
    );
  });

/** One request with deploy.mjs's Host rule: on a loopback bind 127.0.0.1 is the preview host, the API answers as `localhost`. */
function request(
  urlStr: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(urlStr);
  const lib = url.protocol === "https:" ? https : http;
  const headers = {
    ...init.headers,
    ...(url.hostname === "127.0.0.1" ? { host: "localhost" } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: init.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`timed out reading ${url.origin}`)));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

export const httpReadRevision: ReadRevision = async (baseUrl, env) => {
  let auth: Record<string, string>;
  if (env.PENGUIN_API_TOKEN) {
    auth = { authorization: `Bearer ${env.PENGUIN_API_TOKEN}` };
  } else {
    const login = await request(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "admin", password: env.PENGUIN_ADMIN_PASSWORD }),
    });
    const cookies = login.headers["set-cookie"];
    if (login.status !== 200 || cookies === undefined) return null;
    auth = { cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
  }
  const res = await request(`${baseUrl}/api/version`, { headers: auth });
  if (res.status !== 200) return null;
  const report = JSON.parse(res.body) as {
    harness?: { source?: { revision?: string } | null } | null;
  };
  return report.harness?.source?.revision ?? null;
};

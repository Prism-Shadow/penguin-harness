/**
 * Deploys: an organization registers its own deploy scripts, and a deploy runs one of them
 * against a head — a proposal's impl (its declared head branch, else its impl PR), or any open
 * PR of the PR graph.
 *
 * How a project is built and where it ships differs from one company to the next (a
 * TypeScript monorepo pushed to a server, a C++ build uploaded somewhere, a release with no
 * server at all), so the plugin decides none of it. A deploy target is a registered id and the
 * command behind it; the plugin resolves which commit to deploy, starts the command in the
 * organization's shared workspace with that commit in its environment, keeps its output and
 * reports how it exited. Building, credentials and checking the result are the script's.
 *
 *   <root>/<projectId>/organizations/<orgId>/deploy-scripts.json   the registry (the server is its only writer)
 *
 * The script runs on the server that holds the organization, under the server's own account,
 * so registering one is running code there: only a person who is an admin of the server may
 * register or remove a script. Starting a registered one is open to everybody in the
 * organization, a person or an employee — the script is the vetted part. One run per script
 * at a time; a run is stopped after DEPLOY_TIMEOUT_MS. Runs are kept in memory (the last
 * RUNS_KEPT finished ones per organization, each output's last OUTPUT_LIMIT characters), so a
 * restart forgets them; the server log has a line for each start and finish.
 *
 * The script's environment is the server's plus:
 *   PENGUIN_DEPLOY_ID        the script id          PENGUIN_DEPLOY_RUN       the run id
 *   PENGUIN_DEPLOY_REPO      owner/repo of the head PENGUIN_DEPLOY_PR        the PR number (empty: no PR)
 *   PENGUIN_DEPLOY_PR_URL    the PR's URL (empty)   PENGUIN_DEPLOY_BRANCH    the head branch
 *   PENGUIN_DEPLOY_HEAD      the head commit (full sha) — what to deploy
 *   PENGUIN_DEPLOY_PROPOSAL  the proposal number, empty for a PR no proposal registered
 *   PENGUIN_DEPLOY_BY        who started it (`user:<id>` / `agent:<id>`)
 * and its arguments are the registered command's followed by the deploy's extra arguments.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";
import type {
  ProposalDeployPlan,
  ProposalDeployRun,
  ProposalDeployRunResponse,
  ProposalDeployScript,
  ProposalDeployStartResponse,
} from "@prismshadow/penguin-server/api";
import { GITHUB_NAME, ghRunner, parsePullUrl, type RunGh } from "./pr-status.js";
import { ImplBranchError, branchTip } from "./impl-branch.js";
import { ProposalError } from "./service.js";
import { startProcess, type StartProcess } from "./deploy-process.js";

/** The registry's file name inside the organization directory. */
export const DEPLOY_SCRIPTS_FILE = "deploy-scripts.json";

export const DEPLOY_TIMEOUT_MS = 60 * 60_000;
/** After the timeout's SIGTERM, how long a script has before SIGKILL. */
const KILL_GRACE_MS = 10_000;
export const OUTPUT_LIMIT = 1024 * 1024;
export const RUNS_KEPT = 20;

/** A script id: what `--to` names. */
export const SCRIPT_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_DESCRIPTION = 500;

/** The head to deploy, as GitHub reports it; `number` and `url` are null for an impl branch with no PR. */
interface PullHead {
  repo: string;
  number: number | null;
  url: string | null;
  branch: string;
  head: string;
}

/** A proposal's impl as a deploy reads it: its declared head (resolved to a repository), and its PR. */
export interface DeployImpl {
  /** null when the impl was registered as a PR alone: the PR's head is deployed. */
  head: { repo: string; branch: string } | null;
  pr: string | null;
}

/** What a deploy needs of the organization, behind the service's access check (ProposalService.deployScope). */
export interface DeployScope {
  org: OrgView;
  /** `user:<id>` or `agent:<id>`. */
  principal: string;
  /** The caller is a person, not an employee. */
  person: boolean;
  /** A proposal's impl, null when it has none; throws 404 for a proposal that does not exist. */
  impl(number: number): Promise<DeployImpl | null>;
  /** The PR graph's repository (`owner/repo`), null when none is configured or found. */
  deliveryRepo(): Promise<string | null>;
}

export interface DeployDeps {
  scope(projectId: string, orgId: string, actor: OrgActor): Promise<DeployScope>;
  /** The data root (Paths.root). */
  root: string;
  log: (line: string) => void;
  gh?: RunGh;
  start?: StartProcess;
  now?: () => number;
  timeoutMs?: number;
}

export interface DeployRequest {
  script: string;
  /** Deploy this proposal's impl … */
  proposal?: number;
  /** … or this PR of the delivery repository (the PR graph's nodes). */
  pr?: number;
  /** The head the caller saw: refused when the PR has moved since. */
  head?: string;
  /** Extra arguments after the registered command's; checked by argvOf. */
  args?: unknown;
  dryRun?: boolean;
}

const badRequest = (message: string): ProposalError =>
  new ProposalError(400, "bad_request", message);

/** The argument list a request carries (extra arguments, a command), checked; `what` names it in the refusal. */
export function argvOf(raw: unknown, what: string, opts: { min: number }): string[] {
  if (raw === undefined && opts.min === 0) return [];
  if (!Array.isArray(raw) || raw.length < opts.min || raw.length > MAX_ARGS) {
    throw badRequest(`${what} must be a list of ${opts.min}–${MAX_ARGS} strings.`);
  }
  return raw.map((a) => {
    if (typeof a !== "string" || a.length > MAX_ARG_LENGTH || a.includes("\0")) {
      throw badRequest(
        `${what}: every item must be a string of at most ${MAX_ARG_LENGTH} characters.`,
      );
    }
    return a;
  });
}

interface LiveRun {
  run: ProposalDeployRun;
  /** The kept tail of the output, and how many characters were dropped before it. */
  output: string;
  dropped: number;
  orgKey: string;
}

export class DeployService {
  private readonly runs = new Map<string, LiveRun>();
  /** Registry writes, chained per file so two never interleave. */
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: DeployDeps) {}

  private now(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString();
  }

  private file(projectId: string, orgId: string): string {
    return path.join(this.deps.root, projectId, "organizations", orgId, DEPLOY_SCRIPTS_FILE);
  }

  private async readScripts(file: string): Promise<ProposalDeployScript[]> {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const parsed = JSON.parse(text) as { scripts?: unknown };
    return Array.isArray(parsed.scripts) ? (parsed.scripts as ProposalDeployScript[]) : [];
  }

  private async writeScripts(file: string, scripts: ProposalDeployScript[]): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ scripts }, null, 2)}\n`);
    await fs.rename(tmp, file);
  }

  /** Read, change and write the registry, one change at a time per file. */
  private change<T>(
    file: string,
    edit: (scripts: ProposalDeployScript[]) => { scripts: ProposalDeployScript[]; result: T },
  ): Promise<T> {
    const prior = this.writes.get(file) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(async () => {
        const { scripts, result } = edit(await this.readScripts(file));
        await this.writeScripts(file, scripts);
        return result;
      });
    this.writes.set(file, next);
    return next;
  }

  private requireAdmin(scope: DeployScope, isAdmin: boolean, what: string): void {
    if (!scope.person || !isAdmin) {
      throw new ProposalError(
        403,
        "admin_required",
        `Only a person who is an admin of this server can ${what}: a deploy script runs on the server.`,
      );
    }
  }

  async scripts(
    projectId: string,
    orgId: string,
    actor: OrgActor,
  ): Promise<ProposalDeployScript[]> {
    await this.deps.scope(projectId, orgId, actor);
    return this.readScripts(this.file(projectId, orgId));
  }

  async register(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    isAdmin: boolean,
    input: { id: string; command: unknown; description?: string },
  ): Promise<ProposalDeployScript> {
    const scope = await this.deps.scope(projectId, orgId, actor);
    this.requireAdmin(scope, isAdmin, "register a deploy script");
    const id = input.id.trim();
    if (!SCRIPT_ID.test(id)) {
      throw badRequest(
        `Not a deploy script id: ${id} (lower-case letters, digits, ., _ or -, at most 64).`,
      );
    }
    const command = argvOf(input.command, "command", { min: 1 });
    if (command[0]!.trim() === "") throw badRequest("command must start with a program.");
    const description = (input.description ?? "").trim();
    if (description.length > MAX_DESCRIPTION) {
      throw badRequest(`description is too long (max ${MAX_DESCRIPTION} characters).`);
    }
    const script: ProposalDeployScript = {
      id,
      command,
      description,
      by: scope.principal,
      at: this.now(),
    };
    return this.change(this.file(projectId, orgId), (scripts) => {
      if (scripts.some((s) => s.id === id)) {
        throw new ProposalError(
          409,
          "deploy_script_exists",
          `A deploy script ${id} is already registered: remove it first to replace it.`,
        );
      }
      return { scripts: [...scripts, script], result: script };
    });
  }

  async remove(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    isAdmin: boolean,
    id: string,
  ): Promise<void> {
    const scope = await this.deps.scope(projectId, orgId, actor);
    this.requireAdmin(scope, isAdmin, "remove a deploy script");
    await this.change(this.file(projectId, orgId), (scripts) => {
      if (!scripts.some((s) => s.id === id)) throw scriptMissing(id);
      return { scripts: scripts.filter((s) => s.id !== id), result: undefined };
    });
  }

  /** The head to deploy and where it stands now: an impl's declared head branch, else a PR's head. */
  private async pullHead(scope: DeployScope, req: DeployRequest): Promise<PullHead> {
    let url: string;
    if (req.proposal !== undefined) {
      const impl = await scope.impl(req.proposal);
      if (impl === null) {
        throw new ProposalError(
          409,
          "no_impl",
          `Proposal #${req.proposal} has no impl: register its branch or its PR with \`penguin org proposal impl\` first.`,
        );
      }
      if (impl.head !== null) return this.branchHead(impl.head, impl.pr);
      url = impl.pr!;
    } else {
      const repo = await scope.deliveryRepo();
      if (repo === null) {
        throw new ProposalError(
          409,
          "graph_not_configured",
          "No delivery repository: none is set under Settings → Plugins → Company proposals and the shared workspace has no GitHub remote.",
        );
      }
      url = `https://github.com/${repo}/pull/${req.pr}`;
    }
    const ref = parsePullUrl(url);
    if (ref === null || !GITHUB_NAME.test(ref.owner) || !GITHUB_NAME.test(ref.repo)) {
      throw new ProposalError(409, "not_a_github_pr", `Not a GitHub pull request: ${url}`);
    }
    let body: { head?: { sha?: unknown; ref?: unknown }; html_url?: unknown };
    try {
      body = JSON.parse(
        await (this.deps.gh ?? ghRunner())(
          ["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`],
          { timeoutMs: 15_000, maxBytes: 1024 * 1024 },
        ),
      ) as typeof body;
    } catch (err) {
      throw new ProposalError(
        502,
        "pr_unreadable",
        `${ref.owner}/${ref.repo}#${ref.number} could not be read from GitHub: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const head = body.head?.sha;
    if (typeof head !== "string" || !/^[0-9a-f]{40}$/.test(head)) {
      throw new ProposalError(
        502,
        "pr_unreadable",
        `GitHub gave no head commit for ${ref.owner}/${ref.repo}#${ref.number}.`,
      );
    }
    return {
      repo: `${ref.owner}/${ref.repo}`,
      number: ref.number,
      url: typeof body.html_url === "string" ? body.html_url : url,
      branch: typeof body.head?.ref === "string" ? body.head.ref : "",
      head,
    };
  }

  /** A declared head branch's tip, with the PR on it when one is registered. */
  private async branchHead(
    head: { repo: string; branch: string },
    pr: string | null,
  ): Promise<PullHead> {
    let sha: string;
    try {
      sha = await branchTip(this.deps.gh ?? ghRunner(), head.repo, head.branch);
    } catch (err) {
      if (err instanceof ImplBranchError)
        throw new ProposalError(err.status, err.code, err.message);
      throw err;
    }
    const ref = pr === null ? null : parsePullUrl(pr);
    return {
      repo: head.repo,
      number: ref?.number ?? null,
      url: ref === null ? null : pr,
      branch: head.branch,
      head: sha,
    };
  }

  async start(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    req: DeployRequest,
  ): Promise<ProposalDeployStartResponse> {
    const scope = await this.deps.scope(projectId, orgId, actor);
    if (scope.org.machineId !== null) {
      throw new ProposalError(
        409,
        "org_elsewhere",
        `${orgId} runs on another machine (${scope.org.machineId}); deploy from there, where its workspace is.`,
      );
    }
    if ((req.proposal === undefined) === (req.pr === undefined)) {
      throw badRequest("Name either a proposal or a pr.");
    }
    const args = argvOf(req.args, "args", { min: 0 });
    const script = (await this.readScripts(this.file(projectId, orgId))).find(
      (s) => s.id === req.script,
    );
    if (script === undefined) throw scriptMissing(req.script);
    const pull = await this.pullHead(scope, req);
    if (req.head !== undefined && !pull.head.startsWith(req.head.toLowerCase())) {
      throw new ProposalError(
        409,
        "head_moved",
        `${headLabel(pull)} is at ${pull.head.slice(0, 12)} now, not ${req.head.slice(0, 12)}: look again before deploying.`,
      );
    }
    const plan: ProposalDeployPlan = {
      script: script.id,
      repo: pull.repo,
      pr: pull.number,
      prUrl: pull.url,
      branch: pull.branch,
      head: pull.head,
      proposal: req.proposal ?? null,
      argv: [...script.command, ...args],
    };
    if (req.dryRun === true) return { plan };
    const orgKey = `${projectId}/${orgId}`;
    const busy = [...this.runs.values()].find(
      (r) => r.orgKey === orgKey && r.run.script === script.id && r.run.status === "running",
    );
    if (busy !== undefined) {
      throw new ProposalError(
        409,
        "deploy_busy",
        `${script.id} is already running (run ${busy.run.id}, started ${busy.run.startedAt}); wait for it to finish.`,
      );
    }
    return { run: this.launch(orgKey, scope, plan) };
  }

  private launch(orgKey: string, scope: DeployScope, plan: ProposalDeployPlan): ProposalDeployRun {
    const run: ProposalDeployRun = {
      ...plan,
      id: randomBytes(6).toString("hex"),
      status: "running",
      by: scope.principal,
      startedAt: this.now(),
      finishedAt: null,
      exitCode: null,
      error: null,
    };
    const live: LiveRun = { run, output: "", dropped: 0, orgKey };
    this.runs.set(run.id, live);
    this.prune(orgKey);
    const label = `[company-proposals] deploy ${run.id} ${plan.script} ${headLabel(plan)}@${plan.head.slice(0, 12)}`;
    this.deps.log(`${label} started by ${run.by}`);
    const proc = (this.deps.start ?? startProcess)(plan.argv, {
      cwd: scope.org.workspace,
      env: {
        ...process.env,
        PENGUIN_DEPLOY_ID: plan.script,
        PENGUIN_DEPLOY_RUN: run.id,
        PENGUIN_DEPLOY_REPO: plan.repo,
        PENGUIN_DEPLOY_PR: plan.pr === null ? "" : String(plan.pr),
        PENGUIN_DEPLOY_PR_URL: plan.prUrl ?? "",
        PENGUIN_DEPLOY_BRANCH: plan.branch,
        PENGUIN_DEPLOY_HEAD: plan.head,
        PENGUIN_DEPLOY_PROPOSAL: plan.proposal === null ? "" : String(plan.proposal),
        PENGUIN_DEPLOY_BY: run.by,
      },
    });
    let timedOut = false;
    const timeoutMs = this.deps.timeoutMs ?? DEPLOY_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);
    timer.unref();
    proc.onOutput((text) => {
      live.output += text;
      if (live.output.length > OUTPUT_LIMIT) {
        const cut = live.output.length - OUTPUT_LIMIT;
        live.output = live.output.slice(cut);
        live.dropped += cut;
      }
    });
    proc.onExit((code, error) => {
      clearTimeout(timer);
      run.finishedAt = this.now();
      run.exitCode = code;
      run.error = timedOut ? `stopped after the ${Math.round(timeoutMs / 1000)} s limit` : error;
      run.status = timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed";
      this.deps.log(
        `${label} ${run.status}${code === null ? "" : ` (exit ${code})`}${run.error === null ? "" : `: ${run.error}`}`,
      );
      this.prune(orgKey);
    });
    return run;
  }

  /** Forget the oldest finished runs past RUNS_KEPT for one organization. */
  private prune(orgKey: string): void {
    const finished = [...this.runs.values()].filter(
      (r) => r.orgKey === orgKey && r.run.status !== "running",
    );
    for (const r of finished.slice(0, Math.max(0, finished.length - RUNS_KEPT))) {
      this.runs.delete(r.run.id);
    }
  }

  async get(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    id: string,
    from: number,
  ): Promise<ProposalDeployRunResponse> {
    await this.deps.scope(projectId, orgId, actor);
    const live = this.runs.get(id);
    if (live === undefined || live.orgKey !== `${projectId}/${orgId}`) {
      throw new ProposalError(
        404,
        "deploy_not_found",
        `No deploy run ${id} (runs are kept in memory, the last ${RUNS_KEPT} per organization).`,
      );
    }
    const start = Math.max(from, live.dropped);
    const next = live.dropped + live.output.length;
    return {
      run: { ...live.run },
      output: live.output.slice(Math.min(start - live.dropped, live.output.length)),
      from: Math.min(start, next),
      next,
    };
  }
}

const scriptMissing = (id: string): ProposalError =>
  new ProposalError(
    404,
    "deploy_script_not_found",
    `No deploy script ${id}: \`penguin org proposal deploy-script ls\` lists the registered ones.`,
  );

/** `owner/repo#n` for a PR, `owner/repo:branch` for a head branch with none. */
function headLabel(h: {
  repo: string;
  branch: string;
  pr?: number | null;
  number?: number | null;
}): string {
  const n = h.pr ?? h.number ?? null;
  return n === null ? `${h.repo}:${h.branch}` : `${h.repo}#${n}`;
}

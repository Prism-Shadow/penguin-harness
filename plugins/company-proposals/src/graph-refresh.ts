/**
 * The PR graph's read path and its refresher.
 *
 * A read never runs git and never reaches the network: it computes the input key from the
 * stored facts and the proposals (a few hundred rows, milliseconds), answers the snapshot laid
 * out for that key — laying it out from the stored facts and storing it when there is none —
 * and places the deployments on it from the stored comparisons. When the probe is due it starts
 * a refresh in the background and answers what it has, with `refreshing`.
 *
 * A refresh probes first: one `git ls-remote` of the delivery repository. When no ref moved,
 * it only moves the schedule — no fetch, no forge, no snapshot. When something moved (or the
 * refresh was forced, or the last layout lacked a comparison) it reads the forge once, fetches
 * into the mirror what it lacks, computes the missing comparisons there and writes everything
 * in one short transaction. The probe window (5 minutes by default) doubles with each probe
 * that found nothing, up to 30 minutes, and resets on any change. There are no timers: with
 * nobody reading the graph nothing is probed. Three events refresh at once: an impl registered,
 * the refresh button (`?refresh=1`, which waits for it), and a deploy run that ended.
 *
 * One refresher per organization: single flight in the process, and a lease in the store so two
 * plugin instances side by side during a hot update never both fetch. The deployments' own
 * servers are probed on the same beat; what they run is kept in memory, as before.
 */
import { randomUUID } from "node:crypto";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import type { Project } from "./domain.js";
import type { DeploymentStore } from "./deploy-store.js";
import {
  placeDeployment,
  readDeployments,
  type DeploymentReading,
  type ProbeServer,
} from "./deployments.js";
import { buildGraph, type GraphProposal } from "./pr-chain.js";
import {
  PrGraphReader,
  incomplete,
  inputsOf,
  layout,
  storedFacts,
  type GraphProject,
} from "./pr-graph.js";
import type { Forge, GitMirror, GraphStore } from "./ports.js";

/** The probe window when the settings name none. */
export const DEFAULT_WINDOW_MS = 5 * 60_000;
/** The longest a quiet repository goes unprobed while somebody reads its graph. */
export const MAX_WINDOW_MS = 30 * 60_000;
/** After a failed refresh, the next one waits at least this long. */
export const RETRY_MS = 60_000;
/** A lease outlives a refresher that died holding it by this much. */
export const LEASE_MS = 5 * 60_000;

/** The interval after `unchanged` consecutive probes that found nothing: 5, 10, 20, 30 minutes. */
export function intervalAfter(windowMs: number, unchanged: number): number {
  return Math.min(windowMs * 2 ** unchanged, Math.max(MAX_WINDOW_MS, windowMs));
}

/** One organization's graph, as the service hands it to the refresher. */
export interface GraphContext {
  /** `<projectId>/<orgId>`. */
  key: string;
  /** The organization directory: the mirror lives under it. */
  orgDir: string;
  store: GraphStore;
  deployments: Pick<DeploymentStore, "list">;
  /** The project, the proposals as the graph annotates them, and what could not be read for them. */
  inputs(): Promise<{ project: Project; proposals: GraphProposal[]; errors: string[] }>;
}

export interface RefresherDeps {
  log: (line: string) => void;
  now?: () => number;
  /** The probe window, read on every use (a settings save applies at once). */
  windowMs?: () => number;
  mirrorFor(orgDir: string, repo: string): GitMirror;
  forgeFor(project: Project): Forge;
  probe: ProbeServer;
}

interface OrgState {
  running: Promise<void> | null;
  /** Aborts this organization's refresh alone (its git and gh children with it): the organization is being deleted. */
  abort: AbortController;
  /** What each registered deployment runs, by id, as the last probe of its server read it. */
  readings: Map<string, DeploymentReading>;
  /** When the last refresh started, for the floor on refreshes a read triggers for a missing comparison. */
  startedAt: number;
}

export class GraphRefresher {
  private readonly orgs = new Map<string, OrgState>();
  private readonly holder = randomUUID();
  private readonly abort = new AbortController();

  constructor(private readonly deps: RefresherDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private windowMs(): number {
    return this.deps.windowMs?.() ?? DEFAULT_WINDOW_MS;
  }

  private org(key: string): OrgState {
    let s = this.orgs.get(key);
    if (s === undefined) {
      s = { running: null, abort: new AbortController(), readings: new Map(), startedAt: 0 };
      this.orgs.set(key, s);
    }
    return s;
  }

  /** Stops every refresh in flight (its git and gh children with it); the plugin is stopping. */
  stop(): void {
    this.abort.abort();
  }

  /**
   * The organization is being deleted: its refresh in flight is aborted (its git and gh
   * children with it) and awaited, and what is kept of it in memory is dropped. A refresh that
   * starts for it afterwards starts from nothing, as for a new organization.
   */
  async retire(key: string): Promise<void> {
    const state = this.orgs.get(key);
    if (state === undefined) return;
    this.orgs.delete(key);
    state.abort.abort();
    await state.running;
  }

  /** Whether a refresh of this organization is running. */
  refreshing(key: string): boolean {
    return this.orgs.get(key)?.running != null;
  }

  /** Refreshes now, not waiting for the window (an impl registered, a deploy run ended). */
  kick(ctx: GraphContext, force = true): Promise<void> {
    return this.start(ctx, force);
  }

  /** The graph from the store; `refresh` waits for a forced refresh first (the page's button). */
  async read(ctx: GraphContext, opts: { refresh?: boolean } = {}): Promise<ProposalGraphResponse> {
    if (opts.refresh === true) await this.start(ctx, true);
    const { project, proposals, errors } = await ctx.inputs();
    const state = this.org(ctx.key);
    const registered = await ctx.deployments.list();
    const readings = registered.map(
      (d): DeploymentReading =>
        state.readings.get(d.id) ?? {
          id: d.id,
          url: d.url,
          commit: null,
          describe: null,
          error: d.url === null ? NO_URL : "not probed yet",
        },
    );
    const checkedAt = new Date(this.now()).toISOString();
    if (project.repo === null) {
      // No delivery repository: the base branch alone; the deployments still get probed.
      if (
        registered.length > 0 &&
        state.running === null &&
        this.now() - state.startedAt >= this.windowMs()
      ) {
        void this.start(ctx, false);
      }
      const graph = buildGraph({
        repo: "",
        base: { branch: project.base, head: null },
        pulls: [],
        origins: project.origins.map((o) => ({ ...o, pulls: null })),
        compare: () => undefined,
        proposals,
        deployments: readings,
        errors,
        checkedAt,
      });
      return { ...graph, refreshing: state.running !== null };
    }
    const repo = project.repo;
    const refresh = ctx.store.refreshState(repo);
    const graphProject: GraphProject = {
      repo,
      base: project.baseDeclared ? project.base : (refresh.defaultBranch ?? project.base),
      origins: project.origins,
    };
    const facts = storedFacts(ctx.store, graphProject);
    const inputs = inputsOf(facts, graphProject, proposals);
    let snapshot = ctx.store.snapshot(repo, graphProject.base, inputs.inputKey);
    if (snapshot === null) {
      // The facts did not move but the proposals did (an impl registered, a status changed):
      // laid out again from the stored facts, no git and no network.
      const laid = layout(inputs, facts.compare, checkedAt);
      ctx.store.putSnapshot(repo, graphProject.base, inputs.inputKey, laid.graph);
      snapshot = { inputKey: inputs.inputKey, builtAt: checkedAt, checkedAt, graph: laid.graph };
    }
    const graph = snapshot.graph;
    const due =
      refresh.nextProbeAt === null ||
      this.now() >= Date.parse(refresh.nextProbeAt) ||
      (incomplete(graph) && this.now() - state.startedAt >= RETRY_MS);
    if (due && state.running === null) void this.start(ctx, false);
    // The deployments on the layers, from the comparisons stored: a commit no layer was
    // compared with yet sits nowhere until the refresh compares it.
    const commits = readings.flatMap((r) => (r.commit === null ? [] : [r.commit.toLowerCase()]));
    const known = ctx.store.comparisonsTo(repo, commits);
    const layers = [
      { number: 0, head: graph.base.head },
      ...graph.nodes.map((n) => ({ number: n.number, head: n.head })),
    ];
    const deployments = readings.map((r) =>
      placeDeployment(r, layers, (from, to) => known.get(`${from}...${to.toLowerCase()}`)),
    );
    return {
      ...graph,
      errors: [
        ...errors,
        ...graph.errors,
        ...(refresh.lastError !== null
          ? [`${repo}: last refresh failed: ${refresh.lastError}`]
          : []),
      ],
      checkedAt: snapshot.checkedAt,
      deployments,
      refreshing: state.running !== null,
    };
  }

  /** Starts a refresh, or joins the one running; a forced one runs after a running one ends. */
  private start(ctx: GraphContext, force: boolean): Promise<void> {
    const state = this.org(ctx.key);
    if (state.running !== null) {
      return force ? state.running.then(() => this.start(ctx, true)) : state.running;
    }
    state.startedAt = this.now();
    const run = this.refresh(ctx, state, force)
      .catch((err: unknown) => {
        this.deps.log(
          `[company-proposals] ${ctx.key}: graph refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        state.running = null;
      });
    state.running = run;
    return run;
  }

  private async refresh(ctx: GraphContext, state: OrgState, force: boolean): Promise<void> {
    const signal = AbortSignal.any([this.abort.signal, state.abort.signal]);
    const { project, proposals } = await ctx.inputs();
    const registered = await ctx.deployments.list();
    // The deployments' servers, on the same beat as the probe.
    const probing = readDeployments(registered, this.deps.probe).then((readings) => {
      state.readings = new Map(readings.map((r) => [r.id, r]));
      return readings;
    });
    if (project.repo === null) {
      await probing;
      return;
    }
    const repo = project.repo;
    const store = ctx.store;
    if (!store.acquire(repo, this.holder, new Date(this.now() + LEASE_MS).toISOString())) {
      await probing;
      return;
    }
    try {
      const mirror = this.deps.mirrorFor(ctx.orgDir, repo);
      const remote = await mirror.lsRemote(signal);
      const before = store.refreshState(repo);
      const base = project.baseDeclared
        ? project.base
        : (remote.head ?? before.defaultBranch ?? project.base);
      const graphProject: GraphProject = { repo, base, origins: project.origins };
      const previous = store.refs(repo);
      const moved =
        previous.size !== remote.refs.size ||
        [...remote.refs].some(([ref, oid]) => previous.get(ref) !== oid);
      const readings = await probing;
      const commits = readings.flatMap((r) => (r.commit === null ? [] : [r.commit.toLowerCase()]));
      const latest = store.latestSnapshot(repo, base);
      const compared = store.comparisonsTo(repo, commits);
      const deploymentsUnplaced = commits.some(
        (c) => ![...compared.keys()].some((k) => k.endsWith(`...${c}`)),
      );
      if (
        !moved &&
        !force &&
        latest !== null &&
        !incomplete(latest.graph) &&
        !deploymentsUnplaced
      ) {
        const unchanged = before.unchanged + 1;
        store.probeUnchanged(
          repo,
          base,
          unchanged,
          new Date(this.now() + intervalAfter(this.windowMs(), unchanged)).toISOString(),
        );
        return;
      }
      const reader = new PrGraphReader({
        forge: this.deps.forgeFor(project),
        mirror,
        store,
        log: this.deps.log,
      });
      const checkedAt = new Date(this.now()).toISOString();
      const got = await reader.collect({
        project: graphProject,
        proposals,
        refs: remote.refs,
        deploymentCommits: commits,
        checkedAt,
        signal,
      });
      store.write({
        repo,
        refs: remote.refs,
        defaultBranch: remote.head,
        pulls: got.pulls,
        openOf: got.openOf,
        comparisons: got.comparisons,
        used: got.layout.used,
        snapshot: {
          base,
          inputKey: got.inputs.inputKey,
          graph: { ...got.layout.graph, errors: got.errors },
        },
        nextProbeAt: new Date(this.now() + this.windowMs()).toISOString(),
        unchanged: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.failed(repo, message, new Date(this.now() + RETRY_MS).toISOString());
      throw err;
    } finally {
      store.release(repo, this.holder);
    }
  }
}

const NO_URL = "the deployment has no url, so nothing reports the commit it runs";

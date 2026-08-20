/**
 * When an installed workflow is live.
 *
 * A workflow belongs to an agent, and it is registered only while that agent is active:
 * its tools join the tool set when the agent's first session opens and leave when its
 * last one closes, and the state its `park()` returns is written down on the way out. An
 * agent nobody is talking to contributes nothing.
 *
 * Activation is refcounted per agent, because several sessions can hold the same one
 * open, and serialized through one queue, because activate and deactivate both walk the
 * agent's folder and the registry - interleaving them would register a workflow the
 * deactivate that just ran had already parked.
 *
 * `reseed` is the swap's other half. A hot push builds a new App with an empty registry,
 * so every registration made through here died with the old one; the refs parked in the
 * platform document say which agents were active, and this puts them back. Without it a
 * push leaves the tool set empty while the installations look intact.
 */
import type { Json } from "@prismshadow/penguin-core/kernel";
import type { WorkflowRegistry, WorkflowSummary } from "./registry.js";
import type { WorkflowRef, WorkflowStore } from "./store.js";

interface ActiveAgent {
  refs: number;
  projectId: string;
  agentId: string;
  /** The workflow ids this activation registered, so deactivate parks exactly those. */
  workflowIds: Set<string>;
}

const agentKey = (projectId: string, agentId: string): string => `${projectId}/${agentId}`;

export class WorkflowLifecycle {
  private readonly active = new Map<string, ActiveAgent>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: WorkflowStore,
    private readonly registry: WorkflowRegistry,
    private readonly log: (line: string) => void = (line) => console.warn(line),
  ) {}

  /** Registers this agent's workflows on the first hold; later holds only count. */
  activate(projectId: string, agentId: string): Promise<void> {
    return this.serial(async () => {
      const key = agentKey(projectId, agentId);
      const existing = this.active.get(key);
      if (existing !== undefined) {
        existing.refs++;
        return;
      }
      const entry: ActiveAgent = { refs: 1, projectId, agentId, workflowIds: new Set() };
      this.active.set(key, entry);
      await this.registerAll(entry);
    });
  }

  /** Parks and unregisters on the last release. */
  deactivate(projectId: string, agentId: string): Promise<void> {
    return this.serial(async () => {
      const key = agentKey(projectId, agentId);
      const entry = this.active.get(key);
      if (entry === undefined) return;
      entry.refs--;
      if (entry.refs > 0) return;
      this.active.delete(key);
      await this.parkAndRelease(entry);
    });
  }

  /** Process exit: park every activation, whatever its refcount. */
  shutdown(): Promise<void> {
    return this.serial(async () => {
      for (const entry of [...this.active.values()]) {
        this.active.delete(agentKey(entry.projectId, entry.agentId));
        await this.parkAndRelease(entry);
      }
    });
  }

  isActive(projectId: string, agentId: string): boolean {
    return this.active.has(agentKey(projectId, agentId));
  }

  list(): WorkflowSummary[] {
    return this.registry.list();
  }

  /** What the platform document carries: which agents were active, as one ref each. */
  refs(): WorkflowRef[] {
    return [...this.active.values()].flatMap((entry) =>
      [...entry.workflowIds].map((workflowId) => ({
        projectId: entry.projectId,
        agentId: entry.agentId,
        workflowId,
      })),
    );
  }

  /**
   * Re-registers the agents named by the parked refs into this App's registry. Called
   * once at App creation, so a push is invisible to a workflow that was live.
   */
  reseed(refs: WorkflowRef[]): Promise<void> {
    return this.serial(async () => {
      for (const ref of refs) {
        const key = agentKey(ref.projectId, ref.agentId);
        let entry = this.active.get(key);
        if (entry === undefined) {
          entry = {
            refs: 1,
            projectId: ref.projectId,
            agentId: ref.agentId,
            workflowIds: new Set(),
          };
          this.active.set(key, entry);
        }
        if (entry.workflowIds.has(ref.workflowId)) continue;
        await this.registerOne(entry, ref.workflowId);
      }
    });
  }

  /**
   * Installs and registers in one step when the agent is already active; a workflow
   * installed for an idle agent is stored and waits for its next activation.
   */
  async installed(ref: WorkflowRef): Promise<WorkflowSummary | null> {
    const entry = this.active.get(agentKey(ref.projectId, ref.agentId));
    if (entry === undefined) return null;
    return await this.serial(() => this.registerOne(entry, ref.workflowId));
  }

  /** Drops a registration when its installation is removed, parking nothing. */
  removed(ref: WorkflowRef): Promise<void> {
    return this.serial(async () => {
      const entry = this.active.get(agentKey(ref.projectId, ref.agentId));
      entry?.workflowIds.delete(ref.workflowId);
      this.registry.unregister(ref);
    });
  }

  private async registerAll(entry: ActiveAgent): Promise<void> {
    for (const stored of await this.store.list(entry.projectId, entry.agentId)) {
      await this.registerOne(entry, stored.workflowId);
    }
  }

  private async registerOne(
    entry: ActiveAgent,
    workflowId: string,
  ): Promise<WorkflowSummary | null> {
    const ref = { projectId: entry.projectId, agentId: entry.agentId, workflowId };
    try {
      const stored = await this.store.read(ref);
      if (stored === null) return null;
      const summary = this.registry.register(stored, await this.store.readState(ref));
      entry.workflowIds.add(workflowId);
      return summary;
    } catch (err) {
      // One workflow that no longer loads must not keep the agent's others offline.
      this.log(`[workflows] ${entry.agentId}/${workflowId} not registered: ${detail(err)}`);
      return null;
    }
  }

  private async parkAndRelease(entry: ActiveAgent): Promise<void> {
    for (const workflowId of entry.workflowIds) {
      const ref = { projectId: entry.projectId, agentId: entry.agentId, workflowId };
      const result = this.registry.unregister(ref);
      if (result === null) continue;
      await this.writeState(ref, result.parked);
    }
    entry.workflowIds.clear();
  }

  private async writeState(ref: WorkflowRef, parked: Json): Promise<void> {
    try {
      await this.store.writeState(ref, parked);
    } catch (err) {
      this.log(`[workflows] ${ref.agentId}/${ref.workflowId} state not written: ${detail(err)}`);
    }
  }

  /** One queue: activate and deactivate both walk the folder and the registry. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));

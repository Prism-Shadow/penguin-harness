/**
 * The live workflow set of one App.
 *
 * Registration goes into the same `iface.workflow` map extensions write (see
 * ../extension/index.ts), so an installed workflow and an extension-registered one are the same
 * thing to everything downstream. Unlike an extension's, an installed one can arrive after
 * registration closed - installing is an HTTP call against a running App - so this holds
 * the factory map and the instances together and keeps them in step.
 *
 * Which workflows an App starts with is PARKED STATE, not a directory sweep: the refs
 * ride the swap in the platform document (PlatformCtx.workflows), exactly as terminal
 * handle ids do, and create() reloads those and only those. Nothing enumerates agents.
 */
import type { WorkflowFactory, WorkflowInstance, WorkflowInstances } from "../extension/index.js";
import { workflowFactoryFrom } from "./evaluate.js";
import type { StoredWorkflow, WorkflowRef, WorkflowStore } from "./store.js";

export interface WorkflowSummary extends WorkflowRef {
  /** `<agentId>/<workflowId>` - how the HTTP surface names an installation. */
  id: string;
  /** The name the script declares - the key it is callable under. */
  name: string;
  uiRev: string | null;
}

const refId = (ref: WorkflowRef): string => `${ref.agentId}/${ref.workflowId}`;
const refKey = (ref: WorkflowRef): string => `${ref.projectId} ${refId(ref)}`;

export class WorkflowRegistry {
  private readonly summaries = new Map<string, WorkflowSummary>();
  private readonly instances = new Map<string, WorkflowInstance>();

  /**
   * `factories` is the App's own `iface.workflow` map - held, not copied, so a workflow
   * installed after `createApp` closed is registered in the same place an extension's is.
   *
   * Whatever extensions registered before this point is instantiated here, once: those
   * factories are all present by the time the App opens, and building them eagerly is
   * what `instantiateWorkflows` does for an App that has no installations to add.
   */
  constructor(private readonly factories: Map<string, WorkflowFactory>) {
    for (const [name, factory] of factories) this.instances.set(name, factory());
  }

  /** Evaluates the script and makes it callable. Throws if the name is already taken. */
  register(stored: StoredWorkflow): WorkflowSummary {
    const { factory, name } = workflowFactoryFrom(stored.script);
    const existing = this.summaries.get(refKey(stored));
    // A reinstall replaces its own registration; anything else owning the name is a
    // collision, and silently shadowing it would reroute an existing caller.
    if (this.factories.has(name) && existing?.name !== name) {
      throw new Error(`workflow name '${name}' is already registered`);
    }
    if (existing !== undefined && existing.name !== name) this.drop(existing.name);
    this.factories.set(name, factory);
    this.instances.set(name, factory());
    const summary: WorkflowSummary = {
      projectId: stored.projectId,
      agentId: stored.agentId,
      workflowId: stored.workflowId,
      id: stored.id,
      name,
      uiRev: stored.uiRev,
    };
    this.summaries.set(refKey(stored), summary);
    return summary;
  }

  /** Removes one installation. False when this App had nothing registered for it. */
  unregister(ref: WorkflowRef): boolean {
    const summary = this.summaries.get(refKey(ref));
    if (summary === undefined) return false;
    this.drop(summary.name);
    this.summaries.delete(refKey(ref));
    return true;
  }

  private drop(name: string): void {
    this.factories.delete(name);
    this.instances.delete(name);
  }

  list(): WorkflowSummary[] {
    return [...this.summaries.values()];
  }

  /** What rides the swap: enough to reload each installation from the store, nothing more. */
  refs(): WorkflowRef[] {
    return this.list().map(({ projectId, agentId, workflowId }) => ({
      projectId,
      agentId,
      workflowId,
    }));
  }

  /**
   * The instance view over THIS registry, so a workflow installed into a running App is
   * callable immediately. `instantiateWorkflows` builds an eager snapshot instead, which
   * is the right shape for factories that are all registered before the App opens.
   */
  instanceView(): WorkflowInstances {
    return {
      names: () => [...this.instances.keys()],
      get: (name) => this.instances.get(name),
      run: (name, input) => {
        const instance = this.instances.get(name);
        if (instance === undefined) throw new Error(`no workflow named '${name}'`);
        return instance.run(input);
      },
    };
  }
}

/**
 * Reloads the parked installations into a fresh App. A ref whose script is gone or no
 * longer satisfies the contract is reported and skipped: one broken workflow must not
 * fail the App creation carrying every other one.
 */
export async function restoreWorkflows(
  store: WorkflowStore,
  registry: WorkflowRegistry,
  refs: WorkflowRef[],
  log: (line: string) => void = (line) => console.warn(line),
): Promise<void> {
  for (const ref of refs) {
    try {
      const stored = await store.read(ref);
      if (stored === null) {
        log(`[workflows] ${refId(ref)} is parked but no longer on disk; dropped`);
        continue;
      }
      registry.register(stored);
    } catch (err) {
      log(`[workflows] ${refId(ref)} not restored: ${detail(err)}`);
    }
  }
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));

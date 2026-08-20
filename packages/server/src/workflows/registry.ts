/**
 * The live workflow set of one App.
 *
 * Registration goes into the same `iface.workflow` map plugins write (see
 * ../hmr/plugin.ts), so an installed workflow and a plugin-registered one are the same
 * thing to everything downstream. Unlike a plugin's, an installed one can arrive after
 * registration closed - installing is an HTTP call against a running App - so this holds
 * the factory map and the instances together and keeps them in step.
 *
 * Which workflows an App starts with is PARKED STATE, not a directory sweep: the refs
 * ride the swap in the platform document (PlatformCtx.workflows), exactly as terminal
 * handle ids do, and create() reloads those and only those. Nothing enumerates agents.
 *
 * A registration binds three things the script may use, and unbinds all of them on
 * removal: the tools it contributed (each with the undo `register` handed back), the run
 * context it drives an agent through, and the state its `park()` returns - which the
 * caller writes down, since only the caller knows where an installation's state lives.
 */
import type { Json } from "@prismshadow/penguin-core/kernel";
import type { WorkflowFactory, WorkflowInstance, WorkflowInstances } from "../hmr/plugin.js";
import type { WorkflowRunCtx, WorkflowTool, WorkflowToolRegistry } from "./evaluate.js";
import { checkTool, evaluateWorkflow, jsonValue } from "./evaluate.js";
import type { StoredWorkflow, WorkflowRef, WorkflowStore } from "./store.js";

export interface WorkflowSummary extends WorkflowRef {
  /** `<agentId>/<workflowId>` - how the HTTP surface names an installation. */
  id: string;
  /** The name the script declares - the key it is callable under. */
  name: string;
  version: number;
  uiRev: string | null;
  tools: Array<{ name: string; description: string }>;
}

const refId = (ref: WorkflowRef): string => `${ref.agentId}/${ref.workflowId}`;
const refKey = (ref: WorkflowRef): string => `${ref.projectId} ${refId(ref)}`;

interface Registration {
  summary: WorkflowSummary;
  /** Undo for everything the registration bound: tool registrations, so far. */
  undo: Array<() => void>;
  park(): Json;
}

/**
 * The tool set of one App: what workflows contributed, ready for an agent's tool list.
 * Duplicate names are refused rather than shadowed - a tool is reached by name.
 */
export class WorkflowTools implements WorkflowToolRegistry {
  private readonly tools = new Map<string, { owner: string; tool: WorkflowTool }>();

  register(owner: string, tool: WorkflowTool): () => void {
    const existing = this.tools.get(tool.name);
    if (existing !== undefined) {
      throw new Error(`tool '${tool.name}' is already registered by workflow '${existing.owner}'`);
    }
    this.tools.set(tool.name, { owner, tool });
    return () => this.tools.delete(tool.name);
  }

  list(): Array<{ workflowId: string; name: string; description: string }> {
    return [...this.tools.values()].map(({ owner, tool }) => ({
      workflowId: owner,
      name: tool.name,
      description: tool.description,
    }));
  }

  get(name: string): WorkflowTool | undefined {
    return this.tools.get(name)?.tool;
  }
}

export class WorkflowRegistry {
  private readonly registrations = new Map<string, Registration>();
  private readonly instances = new Map<string, WorkflowInstance>();
  readonly tools = new WorkflowTools();

  /**
   * `factories` is the App's own `iface.workflow` map - held, not copied, so a workflow
   * installed after `createApp` closed is registered in the same place a plugin's is.
   * `runCtx` is what a workflow drives an agent through; a registration made before the
   * runtime published one has no agent to reach, and `run` says so rather than throwing
   * a TypeError from inside the script.
   *
   * Whatever plugins registered before this point is instantiated here, once: those
   * factories are all present by the time the App opens, and building them eagerly is
   * what `instantiateWorkflows` does for an App that has no installations to add.
   */
  constructor(
    private readonly factories: Map<string, WorkflowFactory>,
    private readonly runCtxFor: (ref: WorkflowRef) => WorkflowRunCtx | null = () => null,
  ) {
    for (const [name, factory] of factories) this.instances.set(name, factory());
  }

  /**
   * Evaluates the script, binds its tools and run context, and makes it callable.
   * Throws if the name is already taken, or if the script or one of its tools violates
   * its contract - all of which is reported to whoever installed it.
   */
  register(stored: StoredWorkflow, state: Json = null): WorkflowSummary {
    const existing = this.registrations.get(refKey(stored));
    const object = evaluateWorkflow(stored.script, state);
    const name = object.name;
    // A reinstall replaces its own registration; anything else owning the name is a
    // collision, and silently shadowing it would reroute an existing caller.
    if (this.factories.has(name) && existing?.summary.name !== name) {
      throw new Error(`workflow name '${name}' is already registered`);
    }
    if (existing !== undefined) this.release(refKey(stored));

    const id = refId(stored);
    const undo: Array<() => void> = [];
    let unloading = false;
    try {
      object.setup?.({
        registerTool: (tool) => {
          if (unloading) {
            throw new Error(`workflow '${id}' is unloading; cannot register tools`);
          }
          undo.push(this.tools.register(id, checkTool(tool)));
        },
      });
    } catch (err) {
      // Half-registered tools must not outlive a setup that failed.
      for (const fn of undo.reverse()) fn();
      throw err;
    }

    const runCtx = this.runCtxFor(stored);
    const instance: WorkflowInstance = {
      run: (input) => {
        if (runCtx === null) {
          throw new Error(`workflow '${id}' has no agent to run: the runtime published none`);
        }
        return object.run(input, runCtx);
      },
    };
    const factory: WorkflowFactory = () => instance;

    this.factories.set(name, factory);
    this.instances.set(name, instance);
    const summary: WorkflowSummary = {
      projectId: stored.projectId,
      agentId: stored.agentId,
      workflowId: stored.workflowId,
      id: stored.id,
      name,
      version: object.version,
      uiRev: stored.uiRev,
      tools: this.tools.list().filter((t) => t.workflowId === id),
    };
    this.registrations.set(refKey(stored), {
      summary,
      undo: [...undo, () => (unloading = true)],
      park: () => jsonValue(object.park?.() ?? null, `workflow '${id}' park state`),
    });
    return summary;
  }

  /**
   * Removes one installation and returns the state its `park()` gave, for the caller to
   * write down. Null when this App had nothing registered for the ref.
   */
  unregister(ref: WorkflowRef): { parked: Json } | null {
    const registration = this.registrations.get(refKey(ref));
    if (registration === undefined) return null;
    let parked: Json = null;
    try {
      parked = registration.park();
    } catch {
      // A park that cannot be written down loses its state rather than the removal.
      parked = null;
    }
    this.release(refKey(ref));
    return { parked };
  }

  private release(key: string): void {
    const registration = this.registrations.get(key);
    if (registration === undefined) return;
    for (const fn of registration.undo.reverse()) fn();
    this.factories.delete(registration.summary.name);
    this.instances.delete(registration.summary.name);
    this.registrations.delete(key);
  }

  list(): WorkflowSummary[] {
    return [...this.registrations.values()].map((r) => r.summary);
  }

  /** What rides the swap: enough to reload each installation from the store, nothing more. */
  refs(): WorkflowRef[] {
    return this.list().map(({ projectId, agentId, workflowId }) => ({
      projectId,
      agentId,
      workflowId,
    }));
  }

  /** The state every registration would park, so a shutdown can write it all down. */
  parkAll(): Array<{ ref: WorkflowRef; parked: Json }> {
    return [...this.registrations.values()].map((r) => {
      const { projectId, agentId, workflowId } = r.summary;
      let parked: Json = null;
      try {
        parked = r.park();
      } catch {
        parked = null;
      }
      return { ref: { projectId, agentId, workflowId }, parked };
    });
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
 * Reloads the parked installations into a fresh App, each resuming from the state its
 * previous instance parked. A ref whose script is gone or no longer satisfies the
 * contract is reported and skipped: one broken workflow must not fail the App creation
 * carrying every other one.
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
      registry.register(stored, await store.readState(ref));
    } catch (err) {
      log(`[workflows] ${refId(ref)} not restored: ${detail(err)}`);
    }
  }
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));

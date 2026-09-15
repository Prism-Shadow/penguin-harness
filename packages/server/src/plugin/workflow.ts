/**
 * Building the workflow instance view. The types are the SDK's contract
 * (`@prismshadow/penguin-core/plugin`); this is the harness's implementation of it.
 */
import type {
  WorkflowFactory,
  WorkflowInstance,
  WorkflowInstances,
} from "@prismshadow/penguin-core/plugin";

/**
 * The Map handed to plugins at `"initialize"` — `iface.workflow` itself — with the one
 * guarantee the contract states: a duplicate name is an ERROR, not a silent replacement.
 * A bare Map would make the winner depend on plugins.json ordering, and a plugin could
 * take over a name another one already owns without either noticing.
 *
 * Named for what it holds rather than for the concept: a workflow REGISTRY is the App's
 * live workflow set, which holds this map and adds instances, lifetimes and the surfaces
 * an installed workflow needs.
 */
export class WorkflowFactories extends Map<string, WorkflowFactory> {
  override set(name: string, factory: WorkflowFactory): this {
    if (this.has(name)) throw new Error(`workflow '${name}' is already registered`);
    return super.set(name, factory);
  }
}

export function instantiateWorkflows(factories: Map<string, WorkflowFactory>): WorkflowInstances {
  const instances = new Map<string, WorkflowInstance>();
  for (const [name, factory] of factories) instances.set(name, factory());
  return {
    names: () => [...instances.keys()],
    get: (name) => instances.get(name),
    run(name, input) {
      const instance = instances.get(name);
      if (instance === undefined) throw new Error(`no workflow named '${name}'`);
      return instance.run(input);
    },
  };
}

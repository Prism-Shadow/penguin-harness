/**
 * Workflows: the named units a plugin registers and anyone can call.
 *
 * A workflow is registration plus a plain JS call — nothing more. Invoking one is a
 * function call; anything that needs a Session, approval or streaming is a different
 * capability and does not belong on this floor.
 *
 * Factories are registered into the definition view (`iface.workflow`, see ./index.ts)
 * and instantiated once per App creation, after registration closes, so a plugin always
 * sees its own workflow instantiated in the App it registered into.
 */

/** What a registered workflow does when called. Plain JS in, plain JS out. */
export interface WorkflowInstance {
  run(input: unknown): unknown;
}

/**
 * Builds a workflow instance. Called once per App creation, so a factory that keeps
 * state gets a fresh instance per boot — and a hot swap therefore never carries a
 * half-built one across.
 */
export type WorkflowFactory = () => WorkflowInstance;

/**
 * The workflow instances this App built from the registered factories: a plain
 * call-by-name surface, deliberately not an agent one.
 */
export interface WorkflowInstances {
  /** The registered names, in registration order. */
  names(): string[];
  get(name: string): WorkflowInstance | undefined;
  /** Calls a workflow by name; throws when no such workflow is registered. */
  run(name: string, input: unknown): unknown;
}

/**
 * Builds the instance view of the registered factories. Plugin-layer behavior, not
 * platform business: the platform only decides when to build it and what else rides on
 * the context.
 */
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

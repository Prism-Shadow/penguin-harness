/**
 * Workflows: the named units an extension registers and anyone can call.
 *
 * Registration plus a plain JS call — nothing more. Anything needing a Session,
 * approval or streaming is a different capability and does not belong on this floor.
 */

/** What a registered workflow does when called. Plain JS in, plain JS out. */
export interface WorkflowInstance {
  run(input: unknown): unknown;
}

/**
 * Called once per App creation, so a stateful factory gets a fresh instance per boot
 * and a hot swap never carries a half-built one across.
 */
export type WorkflowFactory = () => WorkflowInstance;

/** The instances one App built from the registered factories. */
export interface WorkflowInstances {
  /** In registration order. */
  names(): string[];
  get(name: string): WorkflowInstance | undefined;
  /** Throws when no such workflow is registered. */
  run(name: string, input: unknown): unknown;
}

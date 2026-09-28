/**
 * Deployed events: the in-process hook that tells whoever keeps track of deployed versions
 * that an activity went live on QA or PROD. The deploy service emits one each time a QA or PROD
 * deploy finishes with success; with no listener it is a no-op.
 *
 * A listener subscribes in its own setup and unsubscribes in its effect, so a hot reload never
 * leaves a stale one behind. What a listener throws is its own: the deploy is never failed by it.
 */
import { Component, Interface, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { DeployedEvent } from "./deploy-types.js";

export type DeployedListener = (event: DeployedEvent) => void;

export abstract class ActivityDeployEvents extends Interface<{
  /** Adds a listener for every deployed event from now on. */
  subscribe(listener: DeployedListener): void;
  /** Removes a listener added with subscribe; a no-op for one never added. */
  unsubscribe(listener: DeployedListener): void;
  /** Tells every listener; a listener that throws does not stop the others. */
  emit(event: DeployedEvent): void;
}>() {}

@Component()
export class ActivityDeployEventHub implements ActivityDeployEvents {
  private readonly listeners = new Set<DeployedListener>();

  setup({ effect }: ClassCtx) {
    effect(() => this.listeners.clear());
  }

  subscribe(listener: DeployedListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: DeployedListener): void {
    this.listeners.delete(listener);
  }

  emit(event: DeployedEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(structuredClone(event));
      } catch {
        // A listener's failure is its own.
      }
    }
  }
}

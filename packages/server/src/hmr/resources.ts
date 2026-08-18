/**
 * Runtime-side live resources for the hot platform tree — the registry, and nothing
 * about what a resource IS.
 *
 * The linear-state rule for live resources: a pty/child process never enters the parked
 * context document — it lives here, the document only carries its handle id, and boot
 * claims it back. Because the registry sits outside the reloadable tree, a platform swap
 * never interrupts the resource and never loses output produced during the freeze window.
 *
 * Kind-agnostic on purpose (see ./README.md): a registrant supplies its own disposer, so
 * a pushed platform can introduce a resource type this file has never heard of and still
 * have it shut down at process exit. Spawning anything — a shell, a pty, a connection —
 * is the platform's business and lives there.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";

export class HotResources implements Resources {
  private readonly map = new Map<string, { resource: unknown; dispose?: () => void }>();

  register(id: string, resource: unknown, dispose?: () => void): void {
    this.map.set(id, { resource, dispose });
  }

  claim<T = unknown>(id: string): T | undefined {
    return this.map.get(id)?.resource as T | undefined;
  }

  release(id: string): void {
    this.map.delete(id);
  }

  /**
   * Process-exit sweep: run every registered disposer. Not part of any upgrade path —
   * resources are meant to outlive swaps. A throwing disposer must not strand the rest.
   */
  disposeAll(): void {
    for (const entry of this.map.values()) {
      try {
        entry.dispose?.();
      } catch {
        // Best-effort: the process is going away regardless.
      }
    }
    this.map.clear();
  }
}

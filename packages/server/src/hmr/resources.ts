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

  register(id: string, resource: unknown, dispose?: () => void): () => void {
    const entry = { resource, dispose };
    // Delete before set: Map.set on an existing key KEEPS its original insertion
    // position, so a re-registration (a successor adopting a pty, say) would still be
    // swept in the old owner's slot — and both sweeps below promise reverse REGISTRATION
    // order, which later entries depending on earlier ones rely on.
    this.map.delete(id);
    this.map.set(id, entry);
    // The paired unregister: identity-checked, so it only ever removes THIS registration.
    // An overwrite by a successor makes it a no-op — see the kernel interface's doc.
    return () => {
      if (this.map.get(id) === entry) this.map.delete(id);
    };
  }

  claim<T = unknown>(id: string): T | undefined {
    return this.map.get(id)?.resource as T | undefined;
  }

  /**
   * The reconciliation hook a booting App calls (never the kernel — see the interface in
   * core's boot.ts): disposes and removes every entry of one ID-prefix group (`terminal`
   * covers `terminal:*`), in reverse registration order — later entries may depend on
   * earlier ones, the same convention effects follow. Called only for groups whose
   * declared resource interface the two sides of a swap disagree on; a throwing disposer
   * must not strand the rest.
   */
  disposeGroup(group: string): void {
    const prefix = `${group}:`;
    const ids = [...this.map.keys()].filter((id) => id.startsWith(prefix));
    for (const id of ids.reverse()) {
      try {
        this.map.get(id)?.dispose?.();
      } catch {
        // Best-effort: the group is being discarded regardless.
      }
      this.map.delete(id);
    }
  }

  /**
   * Process-exit sweep: run every registered disposer, newest first (later registrations
   * may depend on earlier ones). Not part of any upgrade path — resources are meant to
   * outlive swaps. A throwing disposer must not strand the rest.
   */
  disposeAll(): void {
    for (const entry of [...this.map.values()].reverse()) {
      try {
        entry.dispose?.();
      } catch {
        // Best-effort: the process is going away regardless.
      }
    }
    this.map.clear();
  }
}

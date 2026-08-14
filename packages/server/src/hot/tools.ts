/**
 * ToolRegistry: the shared surface skills contribute to.
 *
 * Ownership and lifecycle rules (the kernel's effect discipline):
 * - The registry is owned by the PLATFORM INSTANCE (created in its create()),
 *   never module scope — a module-level registry would be a singleton that
 *   silently survives hot swaps and accumulates stale registrations.
 * - register() returns a disposer and every caller must ride it on their own
 *   node's ctx.effect: unloading a skill deregisters exactly its tools.
 * - Registration failures are loud (duplicate name throws), never best-effort.
 */
import { validateToolObject } from "./script.js";
import type { ToolObject } from "./script.js";

export interface ToolInfo {
  name: string;
  description: string;
  /** The skill slot the tool came from (disposal attribution, debugging). */
  owner: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, { tool: ToolObject; owner: string }>();

  /** Validates the tool object (arktype) and registers it; returns the disposer. */
  register(owner: string, candidate: unknown): () => void {
    const tool = validateToolObject(candidate);
    if (this.tools.has(tool.name)) {
      const holder = this.tools.get(tool.name)!.owner;
      throw new Error(`tool '${tool.name}' is already registered (by skill '${holder}')`);
    }
    this.tools.set(tool.name, { tool, owner });
    return () => {
      // Only remove our own registration (a later re-register must not be
      // clobbered by a stale disposer).
      if (this.tools.get(tool.name)?.owner === owner) this.tools.delete(tool.name);
    };
  }

  list(): ToolInfo[] {
    return [...this.tools.values()].map(({ tool, owner }) => ({
      name: tool.name,
      description: tool.description,
      owner,
    }));
  }

  async invoke(name: string, input: unknown): Promise<unknown> {
    const entry = this.tools.get(name);
    if (entry === undefined) throw new Error(`no such tool '${name}'`);
    return await entry.tool.run(input);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

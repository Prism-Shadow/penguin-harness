/**
 * The kinds of semantic id server modules contribute (PRFC-0036 `SemanticIdModule.kinds`): an
 * object a module creates, with a create dialog that names it first and derives its id from the
 * name, as the host's own Projects, Agents, organizations and channels are named.
 *
 * A contribution's data is the kind's name and who may ask; its code half answers the ids the
 * kind's create route refuses as taken, as names only, so a proposal steps around them. A
 * contributed id is kebab-case — letters, digits, `_` and `-`, at most 100 — and a placeholder
 * carries the kind's name (services/semantic-id.ts, `contributedIdRule`). `POST …/suggest-id`
 * takes a contributed kind beside its own; a kind nobody contributes is 400.
 *
 * A contribution naming one of the host's own kinds, or a kind already contributed, is left out
 * and logged: the first one in module order stands.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Opaque, Slot } from "@prismshadow/penguin-core/kernel";
import type { Log } from "../hmr/capabilities.js";

/** The data half of a kind: its name as a create dialog sends it, and who may ask. */
export interface SemanticIdKindData {
  /** Lowercase letters, digits and `_`, starting with a letter; at most 32. */
  kind: string;
  /** `owner` when only the Project's owner may create one (its create route's rule); any member otherwise. */
  access?: "member" | "owner";
}

/** The code half of a kind. */
export interface SemanticIdKindSource {
  /** Every id the kind's create route refuses as taken in the Project, as names only. */
  takenIds(projectId: string): Promise<string[]>;
}

export interface SemanticIdKindsSlots {
  /** One kind of semantic id, with the ids its create route refuses. */
  kinds: Slot<SemanticIdKindData, Opaque<"SemanticIdKindSource", SemanticIdKindSource>>;
}

/** A contributed kind as the route reads it. */
export interface ContributedIdKind extends SemanticIdKindSource {
  kind: string;
  access: "member" | "owner";
}

/** SemanticIdKinds: the kinds contributed to this App, which SemanticIdModule provides. */
@Interface()
export abstract class SemanticIdKinds {
  /** The contributed kind by its name, or null. */
  abstract find(kind: string): ContributedIdKind | null;
  /** Every contributed kind's name, in module order. */
  abstract names(): string[];
}

/** The host's own kinds, which `POST …/suggest-id` answers without a contribution. */
export const HOST_ID_KINDS = ["project", "agent", "org", "channel"] as const;

const KIND_NAME = /^[a-z][a-z0-9_]{0,31}$/;

@Module()
export class SemanticIdModule {
  @Use() private readonly log!: Log;
  @Provide() semanticIdKinds!: SemanticIdKinds;
  setup({ contributions }: ClassCtx) {
    const byName = new Map<string, ContributedIdKind>();
    for (const c of contributions.kinds ?? []) {
      const kind = c.data.kind as string;
      const source = c.code as SemanticIdKindSource | undefined;
      if (
        !KIND_NAME.test(kind) ||
        (HOST_ID_KINDS as readonly string[]).includes(kind) ||
        byName.has(kind) ||
        typeof source?.takenIds !== "function"
      ) {
        this.log.line(
          `[semantic-id] ${c.from}: kind ${JSON.stringify(kind)} is not taken (a host kind, a second contribution, a bad name or no takenIds)`,
        );
        continue;
      }
      byName.set(kind, {
        kind,
        access: c.data.access === "owner" ? "owner" : "member",
        takenIds: (projectId) => source.takenIds(projectId),
      });
    }
    this.semanticIdKinds = {
      find: (kind) => byName.get(kind) ?? null,
      names: () => [...byName.keys()],
    };
  }
}

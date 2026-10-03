/**
 * The registry's index of the contributions on its slot, built once per App (every hot update
 * builds it anew from what the tree hands the registry), and the resolution of a key against an
 * organization's bindings:
 *
 * - an `action` key resolves to the one bound contribution answering it; none is 404, more than
 *   one is 409 `action_ambiguous`, naming each contribution's exact invocation;
 * - the guard of an Action is its own default, or the one bound `guard` contribution's
 *   replacement over it; two bound replacements are ambiguous the same way;
 * - the hooks of a key run in their binding's `position`, then by id. A hook key may end in
 *   `.*` to follow every key under it (`deploy.*`).
 *
 * Conflicts are reported when a key is invoked, never at load: a company binds its own
 * contribution and unbinds the built-in one to replace it, and `conflicts` lists what is
 * ambiguous for `penguin org action check`.
 */
import {
  ActionRefusal,
  SUBJECT_KINDS,
  type ActionCode,
  type Guard,
  type GuardCode,
  type HookCode,
  type SubjectCode,
  type SubjectKind,
} from "./action-model.js";
import { compileParams, type ParamSchema } from "./action-params.js";

/** One contribution as the tree hands it to the registry. */
export interface Contributed {
  id: string;
  /** The contributing module's name. */
  from: string;
  data: Record<string, unknown>;
  code?: unknown;
}

interface Entry {
  id: string;
  from: string;
  /** A plugin's own contribution: bound in every organization unless unbound there. */
  builtin: boolean;
}

export interface IndexedAction extends Entry {
  kind: "action";
  key: string;
  subjects: SubjectKind[];
  params: ParamSchema;
  paramsDecl: Record<string, string>;
  description: string;
  commit: boolean;
  code: ActionCode;
}

export interface IndexedGuard extends Entry {
  kind: "guard";
  key: string;
  code: GuardCode;
}

export interface IndexedHook extends Entry {
  kind: "hook";
  key: string;
  when: "before" | "after";
  code: HookCode;
}

export interface IndexedSubject extends Entry {
  kind: "subject";
  subjects: SubjectKind[];
  code: SubjectCode;
}

export type Indexed = IndexedAction | IndexedGuard | IndexedHook | IndexedSubject;

/** An organization's binding of one contribution, as resolution reads it. */
export interface BindingState {
  enabled: boolean;
  position: number;
  config: Record<string, unknown>;
}

/** The binding of each contribution in one organization: what is stored, else the default. */
export type Bindings = (entry: Indexed) => BindingState;

/** A key two or more bound contributions answer. */
export interface Conflict {
  key: string;
  kind: "action" | "guard";
  contributions: string[];
}

/** The exact invocations of a contribution, for an ambiguous key's answer. */
export function execForms(id: string): { contribution: string; route: string; cli: string } {
  return {
    contribution: id,
    route: `POST …/actions/by-id/${id}/runs`,
    cli: `penguin org action exec ${id}`,
  };
}

const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === "function";

function subjectsOf(raw: unknown): SubjectKind[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is SubjectKind => (SUBJECT_KINDS as readonly string[]).includes(s));
}

/** Whether a hook's key follows `key`: equal, or a `prefix.*` covering it. */
export function hookCovers(hookKey: string, key: string): boolean {
  if (hookKey === key) return true;
  return hookKey.endsWith(".*") && key.startsWith(hookKey.slice(0, -1));
}

export class ActionIndex {
  private constructor(
    readonly entries: readonly Indexed[],
    /** Why a contribution was left out: its id, and the reason. */
    readonly skipped: ReadonlyArray<{ id: string; reason: string }>,
  ) {}

  /**
   * The index of `contributions`; `builtin` says which contributing modules are the plugins'
   * own. A contribution whose code does not fit its kind is left out and reported, never fatal.
   */
  static build(contributions: readonly Contributed[], builtin: ReadonlySet<string>): ActionIndex {
    const entries: Indexed[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const c of contributions) {
      const base = { id: c.id, from: c.from, builtin: builtin.has(c.from) };
      const d = c.data;
      const key = typeof d.key === "string" ? d.key : "";
      try {
        switch (d.kind) {
          case "action": {
            const code = c.code as ActionCode | undefined;
            if (key === "" || code === undefined || !isFn(code.run)) {
              throw new Error("an action needs a key and code with run()");
            }
            const paramsDecl = (d.params ?? {}) as Record<string, string>;
            entries.push({
              ...base,
              kind: "action",
              key,
              subjects: subjectsOf(d.subjects),
              params: compileParams(paramsDecl),
              paramsDecl,
              description: typeof d.description === "string" ? d.description : "",
              commit: d.commit === true,
              code,
            });
            break;
          }
          case "guard":
            if (key === "" || !isFn(c.code)) throw new Error("a guard needs a key and a function");
            entries.push({ ...base, kind: "guard", key, code: c.code as GuardCode });
            break;
          case "hook":
            if (key === "" || !isFn(c.code)) throw new Error("a hook needs a key and a function");
            entries.push({
              ...base,
              kind: "hook",
              key,
              when: d.when === "before" ? "before" : "after",
              code: c.code as HookCode,
            });
            break;
          case "subject": {
            const code = c.code as SubjectCode | undefined;
            if (code === undefined || !isFn(code.state)) {
              throw new Error("a subject resolver needs code with state()");
            }
            entries.push({ ...base, kind: "subject", subjects: subjectsOf(d.subjects), code });
            break;
          }
          default:
            throw new Error(`unknown kind ${String(d.kind)}`);
        }
      } catch (err) {
        skipped.push({ id: c.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return new ActionIndex(entries, skipped);
  }

  byId(id: string): Indexed | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Every bound action, for a listing. */
  actions(bindings: Bindings): IndexedAction[] {
    return this.entries.filter(
      (e): e is IndexedAction => e.kind === "action" && bindings(e).enabled,
    );
  }

  /** The one bound contribution answering `key`. */
  resolve(key: string, bindings: Bindings): IndexedAction {
    const found = this.actions(bindings).filter((e) => e.key === key);
    if (found.length === 0) {
      throw new ActionRefusal(
        404,
        "action_not_found",
        `No Action ${key} is bound in this organization: \`penguin org action ls\` lists them.`,
      );
    }
    if (found.length > 1) throw ambiguous(key, "action", found);
    return found[0]!;
  }

  /** The guard of `action` as the organization binds it, its binding config folded in by the caller. */
  guardOf(action: IndexedAction, bindings: Bindings): Guard {
    const base: Guard = action.code.guard ?? (() => undefined);
    const replacing = this.entries.filter(
      (e): e is IndexedGuard => e.kind === "guard" && e.key === action.key && bindings(e).enabled,
    );
    if (replacing.length > 1) throw ambiguous(action.key, "guard", replacing);
    return replacing.length === 0 ? base : replacing[0]!.code(base);
  }

  /** The bound hooks of `key` at `when`, in order. */
  hooksOf(key: string, when: "before" | "after", bindings: Bindings): IndexedHook[] {
    return this.entries
      .filter(
        (e): e is IndexedHook =>
          e.kind === "hook" && e.when === when && hookCovers(e.key, key) && bindings(e).enabled,
      )
      .sort((a, b) => bindings(a).position - bindings(b).position || a.id.localeCompare(b.id));
  }

  /** The bound resolver of a subject kind (the first by id when two are bound). */
  subjectOf(kind: SubjectKind, bindings: Bindings): IndexedSubject | undefined {
    return this.entries
      .filter(
        (e): e is IndexedSubject =>
          e.kind === "subject" && e.subjects.includes(kind) && bindings(e).enabled,
      )
      .sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  /** Every key two bound actions, or two bound guard replacements, answer. */
  conflicts(bindings: Bindings): Conflict[] {
    const out: Conflict[] = [];
    for (const kind of ["action", "guard"] as const) {
      const byKey = new Map<string, string[]>();
      for (const e of this.entries) {
        if (e.kind !== kind || !bindings(e).enabled) continue;
        byKey.set(e.key, [...(byKey.get(e.key) ?? []), e.id]);
      }
      for (const [key, ids] of byKey) {
        if (ids.length > 1) out.push({ key, kind, contributions: ids.sort() });
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
  }
}

function ambiguous(key: string, kind: string, found: readonly Entry[]): ActionRefusal {
  return new ActionRefusal(
    409,
    "action_ambiguous",
    `${found.length} bound ${kind} contributions answer ${key} (${found.map((f) => f.id).join(", ")}): run one by its id, or unbind the others with \`penguin org action bind <contribution> --off\`.`,
    { contributions: found.map((f) => execForms(f.id)) },
  );
}

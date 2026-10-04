/**
 * An organization's index of the contributions to the Action registry, and the resolution of a
 * key against it. Two standings of contribution go in: the BUILT-IN ones, what the plugins
 * contribute to the slot (the same in every organization, rebuilt with every App), and the
 * organization's COMPANY ones, what its company workflows contribute (company-workflows.ts).
 * Contributing is taking effect; a company contribution outranks a built-in one on its key:
 *
 * - an `action` key resolves to the company workflows' action on it when there is one, else the
 *   built-in one; two of the same standing are 409 `action_ambiguous`, naming each
 *   contribution's exact invocation; none is 404;
 * - the guard of an Action is its own default, replaced by a built-in `guard` contribution if
 *   there is one, then by a company workflow's if there is one — each handed the guard below it;
 *   two of the same standing are ambiguous the same way, answered in the same shape;
 * - the hooks of a key run built-in ones first, by id, then the company workflows', by workflow
 *   id and then id. A hook key may end in `.*` to follow every key under it (`deploy.*`);
 * - a subject kind is read by a company workflow's resolver when one reads it, else a built-in
 *   one, the first by id.
 *
 * Conflicts are reported when a key is invoked, never at load; `conflicts` lists them for
 * `penguin org action check`. What a company workflow may not touch — the `workflow.*` Actions,
 * through which the organization changes its workflows — is left out of the index and reported.
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

/** One contribution as the registry receives it. */
export interface Contributed {
  id: string;
  /** The contributing module's name. */
  from: string;
  data: Record<string, unknown>;
  code?: unknown;
  /** The company workflow that contributes it; absent for a built-in contribution. */
  workflow?: string;
}

interface Entry {
  id: string;
  from: string;
  /** A plugin's own contribution, the same in every organization. */
  builtin: boolean;
  /** The company workflow it comes from; null for a built-in one. */
  workflow: string | null;
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

/** The entries of one key-bearing kind. */
type KindOf<K extends "action" | "guard"> = K extends "action" ? IndexedAction : IndexedGuard;

/** A key two or more contributions of the same standing answer. */
export interface Conflict {
  key: string;
  kind: "action" | "guard";
  contributions: string[];
}

/** The key prefix of the Actions that change an organization's company workflows. */
export const WORKFLOW_KEYS = "workflow.";

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

/** Whether a key reaches the `workflow.*` Actions: one of them, or a hook pattern covering them. */
function touchesWorkflows(key: string): boolean {
  return key.startsWith(WORKFLOW_KEYS) || hookCovers(key, `${WORKFLOW_KEYS}write`);
}

/** Company contributions in their order: by workflow id, then by id. */
const companyOrder = (a: Entry, b: Entry) =>
  (a.workflow ?? "").localeCompare(b.workflow ?? "") || a.id.localeCompare(b.id);

/** The entry of one contribution; throws the reason it cannot be indexed. */
function entryOf(c: Contributed): Indexed {
  const base = {
    id: c.id,
    from: c.from,
    builtin: c.workflow === undefined,
    workflow: c.workflow ?? null,
  };
  const d = c.data;
  const key = typeof d.key === "string" ? d.key : "";
  if (!base.builtin && d.kind !== "subject" && touchesWorkflows(key)) {
    throw new Error(`a company workflow does not replace or hook ${WORKFLOW_KEYS}*`);
  }
  switch (d.kind) {
    case "action": {
      const code = c.code as ActionCode | undefined;
      if (key === "" || code === undefined || !isFn(code.run)) {
        throw new Error("an action needs a key and code with run()");
      }
      const paramsDecl = (d.params ?? {}) as Record<string, string>;
      return {
        ...base,
        kind: "action",
        key,
        subjects: subjectsOf(d.subjects),
        params: compileParams(paramsDecl),
        paramsDecl,
        description: typeof d.description === "string" ? d.description : "",
        commit: d.commit === true,
        code,
      };
    }
    case "guard":
      if (key === "" || !isFn(c.code)) throw new Error("a guard needs a key and a function");
      return { ...base, kind: "guard", key, code: c.code as GuardCode };
    case "hook":
      if (key === "" || !isFn(c.code)) throw new Error("a hook needs a key and a function");
      return {
        ...base,
        kind: "hook",
        key,
        when: d.when === "before" ? "before" : "after",
        code: c.code as HookCode,
      };
    case "subject": {
      const code = c.code as SubjectCode | undefined;
      if (code === undefined || !isFn(code.state)) {
        throw new Error("a subject resolver needs code with state()");
      }
      return { ...base, kind: "subject", subjects: subjectsOf(d.subjects), code };
    }
    default:
      throw new Error(`unknown kind ${String(d.kind)}`);
  }
}

export class ActionIndex {
  private constructor(
    readonly entries: readonly Indexed[],
    /** Why a contribution was left out: its id, and the reason. */
    readonly skipped: ReadonlyArray<{ id: string; reason: string }>,
  ) {}

  /**
   * The index of `contributions`. One whose code does not fit its kind, a company one reaching
   * the `workflow.*` Actions, or one reusing an id already indexed is left out and reported,
   * never fatal.
   */
  static build(contributions: readonly Contributed[]): ActionIndex {
    const entries: Indexed[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const ids = new Set<string>();
    for (const c of contributions) {
      try {
        if (ids.has(c.id)) throw new Error(`the id ${c.id} is taken by another contribution`);
        entries.push(entryOf(c));
        ids.add(c.id);
      } catch (err) {
        skipped.push({ id: c.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return new ActionIndex(entries, skipped);
  }

  byId(id: string): Indexed | undefined {
    return this.entries.find((e) => e.id === id);
  }

  private ofKey<K extends "action" | "guard">(
    kind: K,
    key: string,
  ): { company: KindOf<K>[]; builtin: KindOf<K>[] } {
    const all = this.entries.filter(
      (e) => e.kind === kind && (e as IndexedAction | IndexedGuard).key === key,
    ) as KindOf<K>[];
    return {
      company: all.filter((e: Entry) => !e.builtin).sort(companyOrder),
      builtin: all.filter((e: Entry) => e.builtin),
    };
  }

  /** Whether a company workflow's contribution takes the place of this built-in one. */
  replaced(entry: Indexed): boolean {
    if (!entry.builtin || (entry.kind !== "action" && entry.kind !== "guard")) return false;
    return this.ofKey(entry.kind, entry.key).company.length > 0;
  }

  /** The Actions in force: every action contribution no company one replaces. */
  actions(): IndexedAction[] {
    return this.entries.filter((e): e is IndexedAction => e.kind === "action" && !this.replaced(e));
  }

  /** The one contribution answering `key`. */
  resolve(key: string): IndexedAction {
    const { company, builtin } = this.ofKey("action", key);
    const found = company.length > 0 ? company : builtin;
    if (found.length === 0) {
      throw new ActionRefusal(
        404,
        "action_not_found",
        `No Action ${key} in this organization: \`penguin org action ls\` lists them.`,
      );
    }
    if (found.length > 1) throw ambiguous(key, "action", found);
    return found[0]!;
  }

  /**
   * The guard of `action` in force: its default, under a built-in replacement, under a company
   * one. With `only` — a guard contribution named exactly — that guard judges alone: it is
   * handed the guard below its own standing, as it would be in force, and nothing above or
   * beside it is asked.
   */
  guardOf(action: IndexedAction, only?: IndexedGuard): Guard {
    let guard: Guard = action.code.guard ?? (() => undefined);
    const { company, builtin } = this.ofKey("guard", action.key);
    for (const layer of [builtin, company]) {
      if (only !== undefined && layer.includes(only)) return only.code(guard);
      if (layer.length > 1) throw ambiguous(action.key, "guard", layer);
      if (layer.length === 1) guard = layer[0]!.code(guard);
    }
    return guard;
  }

  /** The hooks of `key` at `when`, in order: built-in by id, then company by workflow and id. */
  hooksOf(key: string, when: "before" | "after"): IndexedHook[] {
    const hooks = this.entries.filter(
      (e): e is IndexedHook => e.kind === "hook" && e.when === when && hookCovers(e.key, key),
    );
    return [
      ...hooks.filter((e) => e.builtin).sort((a, b) => a.id.localeCompare(b.id)),
      ...hooks.filter((e) => !e.builtin).sort(companyOrder),
    ];
  }

  /** The resolver of a subject kind: a company workflow's first, else a built-in one. */
  subjectOf(kind: SubjectKind): IndexedSubject | undefined {
    const resolvers = this.entries.filter(
      (e): e is IndexedSubject => e.kind === "subject" && e.subjects.includes(kind),
    );
    return (
      resolvers.filter((e) => !e.builtin).sort(companyOrder)[0] ??
      resolvers.filter((e) => e.builtin).sort((a, b) => a.id.localeCompare(b.id))[0]
    );
  }

  /** Every key two actions, or two guard replacements, of the same standing answer. */
  conflicts(): Conflict[] {
    const out: Conflict[] = [];
    for (const kind of ["action", "guard"] as const) {
      const keys = this.entries
        .filter((e): e is IndexedAction | IndexedGuard => e.kind === kind)
        .map((e) => e.key);
      for (const key of new Set(keys)) {
        const { company, builtin } = this.ofKey(kind, key);
        for (const layer of [company, builtin]) {
          if (layer.length > 1) {
            out.push({ key, kind, contributions: layer.map((e) => e.id).sort() });
          }
        }
      }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
  }
}

function ambiguous(key: string, kind: string, found: readonly Entry[]): ActionRefusal {
  return new ActionRefusal(
    409,
    "action_ambiguous",
    `${found.length} ${kind} contributions answer ${key} (${found.map((f) => f.id).join(", ")}): run one by its id, or change the company workflows so that one answers it.`,
    { contributions: found.map((f) => execForms(f.id)) },
  );
}

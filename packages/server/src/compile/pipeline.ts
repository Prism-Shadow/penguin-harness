/** Registered, immutable rewrites followed by final-target decoration and verification. */
import type {
  Decoration,
  ModuleDef,
  ModuleEdit,
  ModulePass,
  OperatorOrigin,
  RewriteCtx,
  TableLike,
  satisfies,
} from "@prismshadow/penguin-core/kernel";
import {
  checkTree,
  materializeDecorations,
  ModuleBootError,
  tableOf,
} from "@prismshadow/penguin-core/kernel";
import {
  contributionsOf,
  copyTree,
  declNameOf,
  manifestTreeOf,
  providedIfaceNames,
  walkDefs,
} from "./tree.js";
import { PASSES_SLOT, type PassDecl } from "./module.js";
import { diagnosticFor, ModuleCompileError } from "./diagnostics.js";
import { finalCompatibility } from "./verify.js";

export type { ModulePass, RewriteCtx } from "@prismshadow/penguin-core/kernel";
export type PassState = "applied" | "skipped" | "failed";
export interface PassTrace {
  id: string;
  state: PassState;
  ms: number;
  why?: string;
}
export interface CompileResult {
  tree: ModuleDef;
  trace: PassTrace[];
  edits: readonly ModuleEdit[];
  compare: typeof satisfies;
  profile?: { modules: number; interfaces: number; verificationMs: number; decorationMs: number };
}
export interface CompileOpts {
  ifaces: TableLike;
  resolve?: (id: string) => ModulePass | undefined;
  debug?: boolean;
}

export async function compileModuleTree(
  root: ModuleDef,
  opts: CompileOpts,
): Promise<CompileResult> {
  const debug = opts.debug === true;
  const trace: PassTrace[] = [];
  const note = (entry: PassTrace): void => {
    if (debug) trace.push(entry);
  };
  let tree = copyTree(root);
  const seen = new Set<string>();
  const runs: PassDecl[] = [];
  for (const reg of contributionsOf<PassDecl>(tree, PASSES_SLOT)) {
    if (
      typeof reg.id !== "string" ||
      reg.id.length === 0 ||
      (reg.after !== undefined &&
        (!Array.isArray(reg.after) || reg.after.some((id) => typeof id !== "string")))
    ) {
      throw new ModuleBootError(
        "pass registration requires a nonempty id and an optional array of after ids",
      );
    }
    if (seen.has(reg.id))
      throw new ModuleBootError(
        `contribution id '${reg.id}' is already used by another pass registration`,
      );
    seen.add(reg.id);
    runs.push(reg);
  }
  const edits: ModuleEdit[] = [];
  const rules: Decoration[] = [];
  let shared = new Map<string, unknown>();
  for (const reg of orderPasses(runs)) {
    const start = debug ? performance.now() : 0;
    try {
      const pass = opts.resolve?.(reg.id);
      if (pass === undefined) {
        console.warn(`[compile] pass '${reg.id}' is registered but nothing resolves it`);
        note({ id: reg.id, state: "skipped", ms: 0, why: "registered, no resolver for this id" });
        continue;
      }
      if (pass.id !== reg.id) throw new Error(`factory for '${reg.id}' returned pass '${pass.id}'`);
      const provided =
        (pass.requires?.length ?? 0) > 0
          ? providedIfaceNames(tree, opts.ifaces)
          : new Set<string>();
      const missing = (pass.requires ?? []).map(declNameOf).filter((name) => !provided.has(name));
      if (missing.length > 0) {
        note({
          id: reg.id,
          state: "skipped",
          ms: 0,
          why: `requires [${missing.join(", ")}], not provided by this tree`,
        });
        continue;
      }
      let index = 0;
      let origin: OperatorOrigin = {
        pass: pass.id,
        operator: "rewrite",
        index,
        ...pass.owner,
        ...(pass.source ? { source: pass.source } : {}),
      };
      const changed: ModuleEdit[] = [];
      const deferred: Decoration[] = [];
      const local = new Map(shared);
      const ctx: RewriteCtx = {
        ifaces: opts.ifaces,
        shared: local,
        operation(name, run) {
          const parent = origin;
          origin = { ...origin, operator: name, index: ++index };
          try {
            return run();
          } finally {
            origin = parent;
          }
        },
        changed(edit) {
          changed.push({ ...edit, origin });
        },
        defer(rule) {
          deferred.push({ ...rule, origin });
        },
      };
      const result = await pass.rewrite(tree, ctx);
      if (result === null || typeof result !== "object" || typeof result.manifest !== "object") {
        throw new Error(`pass '${reg.id}' returned no tree`);
      }
      const next = copyTree(result);
      if (result !== tree) {
        // Escape-hatch rewrites cannot provide field-level lineage; retain changed owners.
        const before = new Map([...walkDefs(tree)].map((node) => [node.manifest.name, node]));
        const recorded = new Set(changed.map((edit) => edit.module));
        for (const node of walkDefs(next)) {
          const old = before.get(node.manifest.name);
          if (
            !recorded.has(node.manifest.name) &&
            (old === undefined ||
              old.create !== node.create ||
              JSON.stringify(old.manifest) !== JSON.stringify(node.manifest))
          ) {
            changed.push({ module: node.manifest.name, origin });
          }
          before.delete(node.manifest.name);
        }
        for (const name of before.keys()) {
          if (!recorded.has(name)) changed.push({ module: name, removed: true, origin });
        }
      }
      tree = next;
      shared = local;
      edits.push(...changed);
      rules.push(...deferred);
      note({ id: reg.id, state: "applied", ms: debug ? performance.now() - start : 0 });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      console.warn(`[compile] pass '${reg.id}' failed and was set aside: ${why}`);
      note({ id: reg.id, state: "failed", ms: debug ? performance.now() - start : 0, why });
    }
  }
  const verificationStart = debug ? performance.now() : 0;
  const compare = await finalCompatibility(tree, opts.ifaces);
  const { problems } = checkTree(manifestTreeOf(tree), opts.ifaces, {}, compare);
  if (problems.length > 0)
    throw new ModuleCompileError(problems.map((problem) => diagnosticFor(problem, edits)));
  const verificationMs = debug ? performance.now() - verificationStart : 0;
  const decorationStart = debug ? performance.now() : 0;
  const compiled = copyTree(materializeDecorations(tree, rules));
  const decorationMs = debug ? performance.now() - decorationStart : 0;
  return {
    tree: compiled,
    trace,
    edits,
    compare,
    ...(debug
      ? {
          profile: {
            modules: [...walkDefs(tree)].length,
            interfaces: Object.keys(tableOf(opts.ifaces).ifaces).length,
            verificationMs,
            decorationMs,
          },
        }
      : {}),
  };
}

/** Kahn ordering with lexical ids for simultaneously ready passes. */
function orderPasses(registered: readonly PassDecl[]): PassDecl[] {
  const byId = new Map(registered.map((reg) => [reg.id, reg]));
  const pending = new Map(
    registered.map((reg) => [reg.id, new Set((reg.after ?? []).filter((id) => byId.has(id)))]),
  );
  const ready = registered
    .filter((reg) => pending.get(reg.id)!.size === 0)
    .map((reg) => reg.id)
    .sort();
  const out: PassDecl[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    pending.delete(id);
    for (const [next, deps] of pending) {
      if (deps.delete(id) && deps.size === 0) ready.push(next);
    }
    ready.sort();
  }
  if (pending.size > 0) {
    // Follow remaining predecessor edges until an actual cycle repeats.
    const path: string[] = [];
    let id = [...pending.keys()].sort()[0]!;
    while (!path.includes(id)) {
      path.push(id);
      id = [...pending.get(id)!].sort()[0]!;
    }
    const cycle = [...path.slice(path.indexOf(id)), id].reverse();
    throw new ModuleBootError(`pass dependencies form a cycle: ${cycle.join(" -> ")}`);
  }
  return out;
}

/** The compile's one-line log form: every pass with its outcome, in order. */
export function describeCompile(trace: readonly PassTrace[]): string {
  if (trace.length === 0) return "no passes";
  return trace
    .map((t) => {
      const tail =
        t.state === "applied" ? ` ${t.ms.toFixed(1)}ms` : t.why === undefined ? "" : ` (${t.why})`;
      return `${t.id}: ${t.state}${tail}`;
    })
    .join("; ");
}

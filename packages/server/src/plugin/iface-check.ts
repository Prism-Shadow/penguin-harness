/**
 * Do the interfaces a package was written against still fit this platform?
 *
 * A comparison needs two declarations. Looking both sides up in the platform's own table
 * compares a declaration with itself and can never fail, so here each side brings its own:
 * the CONSUMER's is the table the package carries — a plugin's generated `ifaces.json` —
 * and the PLATFORM's is this generation's. Nothing in
 * this module judges assignability itself: each table is rendered as a self-contained
 * `.d.ts`, the questions become assignments in a third file, and the TypeScript compiler
 * answers them —
 *
 *   requires  the platform's interface must be assignable to the consumer's view of it;
 *   provides  the consumer's view must be assignable to what the platform asks for.
 *
 * Two rules keep a pass meaningful. The consumer's table is never substituted: an
 * interface it does not carry is reported as uncompared, never answered from the platform's
 * entry. And rendering is lossless or it refuses: an expression this module cannot write as
 * TypeScript is reported by name, never widened to `unknown`.
 */
import os from "node:os";
import path from "node:path";
import type {
  IfaceDecl,
  IfaceTable,
  Manifest,
  Sig,
  TypeExpr,
} from "@prismshadow/penguin-core/kernel";
import type { TypeScript } from "./typescript.js";

export class IfaceRenderError extends Error {}

/** `<package>#<Export>` → its package; null for a reference with no package part. */
export function packageOf(key: string): string | null {
  const at = key.indexOf("#");
  return at <= 0 ? null : key.slice(0, at);
}

// ---- table → .d.ts ------------------------------------------------------------------

const WORDS = new Set([
  ..."string number boolean bigint symbol object null undefined unknown never true false Date".split(
    " ",
  ),
]);
const INFIX = new Set(["|", "&"]);
/** Opaque identities that name a type of TypeScript's own library (`lib#<Name>` in the table). */
const LIB_TYPES = new Set(["lib#Uint8Array"]);
const OPERATORS = new Set(["[]", "|", "&", "?", "=>", ":", "=", "@", "===", "keyof", "instanceof"]);

/** An arktype string expression is written as TypeScript already, for the subset checked here. */
function stringExpression(expr: string, where: string): string {
  const rest = expr
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/-?\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => (WORDS.has(word) ? " " : word));
  if (!/^[\s|&()[\]]*$/.test(rest)) {
    throw new IfaceRenderError(
      `${where}: '${expr}' is not an expression this check can write as TypeScript`,
    );
  }
  return `(${expr})`;
}

/** Whether a parameter's type lets the argument be left out. */
function admitsUndefined(e: TypeExpr): boolean {
  if ("maybe" in e) return true;
  if ("oneOf" in e) return e.oneOf.some(admitsUndefined);
  if (!("data" in e)) return false;
  const inData = (d: unknown): boolean =>
    typeof d === "string"
      ? d.split("|").some((part) => part.trim() === "undefined")
      : Array.isArray(d) && d.length === 3 && d[1] === "|" && (inData(d[0]) || inData(d[2]));
  return inData(e.data);
}

const property = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

class Renderer {
  private readonly names = new Map<string, string>();
  private readonly taken = new Set<string>();
  private readonly out: string[] = [];
  private readonly done = new Set<string>();

  constructor(private readonly table: IfaceTable) {}

  /**
   * The identifier a table key is declared under: its export name (`…#SessionIndex` →
   * `SessionIndex`), numbered on a clash — so the text reads as a declaration file an author
   * can write against, and a diagnostic names the type the way its source does.
   */
  ident(key: string): string {
    let name = this.names.get(key);
    if (name !== undefined) return name;
    const base = key
      .slice(key.indexOf("#") + 1)
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "_$1");
    name = base;
    for (let n = 2; this.taken.has(name); n++) name = `${base}_${n}`;
    this.taken.add(name);
    this.names.set(key, name);
    return name;
  }

  /** What was rendered, as a table of its own: the declared interfaces and all they reach. */
  readonly slice: IfaceTable = { ifaces: {}, types: {} };

  iface(key: string): string {
    const name = this.ident(`iface ${key}`);
    if (this.done.has(name)) return name;
    this.done.add(name);
    const decl = this.table.ifaces[key];
    if (decl === undefined) throw new IfaceRenderError(`'${key}' is not in the table`);
    this.slice.ifaces[key] = decl;
    this.out.push(this.interfaceText(name, key, decl));
    return name;
  }

  text(): string {
    return [
      // Branded by a plain, string-keyed property — never `unique symbol`. Each side is its
      // own file, and a `unique symbol` declared in each is two different symbols, so the
      // same opaque rendered on both sides would not be assignable to itself. The name is
      // the identity (core/src/kernel/markers.ts), which is what the table records.
      "type Opaque<Name extends string> = { readonly __opaque: Name };",
      ...this.out,
    ].join("\n");
  }

  private namedType(key: string): string {
    const name = this.ident(`type ${key}`);
    if (this.done.has(name)) return name;
    this.done.add(name);
    const def = this.table.types[key];
    if (def === undefined)
      throw new IfaceRenderError(`type '${key}' is referenced but not in the table`);
    this.slice.types[key] = def;
    // Reserve the slot first: a recursive type refers to itself by this name.
    const at = this.out.push("") - 1;
    this.out[at] = `export type ${name} = ${this.data(def, key)};`;
    return name;
  }

  private interfaceText(name: string, key: string, decl: IfaceDecl): string {
    // Members are PROPERTIES of function type: under strictFunctionTypes their parameters
    // are contravariant, the rule the module tree states. Method shorthand is bivariant
    // and would let a narrowed parameter through.
    const methods = Object.entries(decl.methods).map(
      ([m, sig]) => `  ${property(m)}: ${this.sig(sig, `${key}.${m}`)};`,
    );
    const fields = Object.entries(decl.fields ?? {}).map(
      ([f, e]) => `  ${property(f)}${"maybe" in e ? "?" : ""}: ${this.expr(e, `${key}.${f}`)};`,
    );
    return `export interface ${name} {\n${[...methods, ...fields].join("\n")}\n}`;
  }

  private sig(sig: Sig, where: string): string {
    // The table has no "optional parameter", only a type that admits undefined; trailing
    // ones are written back as optional, or `f()` would not type-check against `f(a?: T)`.
    let required = sig.params.length;
    while (required > 0 && admitsUndefined(sig.params[required - 1]!)) required--;
    const params = sig.params.map(
      (p, i) => `a${i}${i >= required ? "?" : ""}: ${this.expr(p, where)}`,
    );
    return `(${params.join(", ")}) => ${this.expr(sig.returns, where)}`;
  }

  private expr(e: TypeExpr, where: string): string {
    if ("data" in e) return this.data(e.data, where);
    if ("iface" in e) return this.iface(e.iface);
    if ("fn" in e) return `(${this.sig(e.fn, where)})`;
    if ("promise" in e) return `Promise<${this.expr(e.promise, where)}>`;
    if ("stream" in e)
      return e.returns === undefined
        ? `AsyncIterable<${this.expr(e.stream, where)}>`
        : `AsyncGenerator<${this.expr(e.stream, where)}, ${this.expr(e.returns, where)}>`;
    if ("void" in e) return "void";
    if ("array" in e) return `Array<${this.expr(e.array, where)}>`;
    if ("object" in e) {
      const optional = new Set(e.optional ?? []);
      const members = Object.entries(e.object).map(
        ([k, v]) => `${property(k)}${optional.has(k) ? "?" : ""}: ${this.expr(v, where)}`,
      );
      return `{ ${members.join("; ")} }`;
    }
    if ("maybe" in e) return `(${this.expr(e.maybe, where)} | null | undefined)`;
    if ("oneOf" in e) return `(${e.oneOf.map((x) => this.expr(x, where)).join(" | ")})`;
    // A type of the language's own library is the same type in every program: it is written
    // as itself, where a host-declared opaque is a brand nobody else can construct.
    if ("opaque" in e && LIB_TYPES.has(e.opaque)) return e.opaque.slice("lib#".length);
    if ("opaque" in e) return `Opaque<${JSON.stringify(e.opaque)}>`;
    throw new IfaceRenderError(
      `${where}: ${JSON.stringify(e).slice(0, 120)} has no TypeScript rendering`,
    );
  }

  /** An arktype definition (string expression, tuple expression or object form). */
  private data(def: unknown, where: string): string {
    if (typeof def === "string") return stringExpression(def, where);
    if (Array.isArray(def)) {
      if (def.length === 2 && def[1] === "[]") return `Array<${this.data(def[0], where)}>`;
      if (def.length === 3 && typeof def[1] === "string" && INFIX.has(def[1])) {
        return `(${this.data(def[0], where)} ${def[1]} ${this.data(def[2], where)})`;
      }
      if (!def.some((x) => typeof x === "string" && OPERATORS.has(x))) {
        return `[${def.map((x) => this.data(x, where)).join(", ")}]`;
      }
    } else if (def !== null && typeof def === "object") {
      const record = def as Record<string, unknown>;
      if (typeof record["$ref"] === "string") return this.namedType(record["$ref"]);
      const members = Object.entries(record).map(([k, v]) => {
        if (k === "[string]") return `[key: string]: ${this.data(v, where)}`;
        if (k === "+" || k === "..." || k.startsWith("[")) {
          throw new IfaceRenderError(`${where}: object key '${k}' has no TypeScript rendering`);
        }
        const optional = k.endsWith("?");
        return `${property(optional ? k.slice(0, -1) : k)}${optional ? "?" : ""}: ${this.data(v, where)}`;
      });
      return `{ ${members.join("; ")} }`;
    }
    throw new IfaceRenderError(
      `${where}: ${JSON.stringify(def).slice(0, 120)} has no TypeScript rendering`,
    );
  }
}

/**
 * A self-contained `.d.ts` declaring `keys` (and everything they reach) out of `table`,
 * with the part of the table it was made from.
 */
export function renderDts(
  table: IfaceTable,
  keys: readonly string[],
): { text: string; names: Map<string, string>; slice: IfaceTable } {
  const renderer = new Renderer(table);
  const names = new Map(keys.map((key) => [key, renderer.iface(key)]));
  return { text: renderer.text(), names, slice: renderer.slice };
}

// ---- the questions --------------------------------------------------------------------

export interface IfaceQuestion {
  /** The module asking, for the message. */
  module: string;
  alias: string;
  direction: "requires" | "provides";
  /** `<package>#<Export>`. */
  key: string;
}

/** The interfaces manifests name with a package part, as questions for the compiler. */
export function ifaceQuestions(manifests: readonly Manifest[]): IfaceQuestion[] {
  const out: IfaceQuestion[] = [];
  for (const m of manifests) {
    for (const [alias, need] of Object.entries(m.requires)) {
      if (packageOf(need.iface) === null) continue;
      out.push({ module: m.name, alias, direction: "requires", key: need.iface });
    }
    for (const [alias, ref] of Object.entries(m.provides)) {
      if (packageOf(ref) === null) continue;
      out.push({ module: m.name, alias, direction: "provides", key: ref });
    }
  }
  return out;
}

export interface IfaceCheckResult {
  /** Why the package does not fit; empty when every comparison passed. */
  problems: string[];
  /** Interfaces that could not be compared: the consumer's table carries no copy of them. */
  uncompared: string[];
}

/**
 * Answers every question with the compiler. A question about an interface this platform
 * does not declare is not one for here (the tree check names it). One the consumer's table
 * does not carry cannot be compared, and is never answered from the platform's own entry:
 * it is reported as `uncompared`, and whether that is a failure is the caller's rule.
 */
export function checkIfaces(
  ts: TypeScript,
  platform: IfaceTable,
  consumer: IfaceTable,
  questions: readonly IfaceQuestion[],
): IfaceCheckResult {
  const problems: string[] = [];
  const uncompared: string[] = [];
  const label = (q: IfaceQuestion) => `${q.module}: ${q.direction}.${q.alias} '${q.key}'`;
  const base = path.join(os.tmpdir(), "penguin-iface-check");
  const files = new Map<string, string>();
  const asked = questions.filter((q) => {
    // Either side missing its copy means there is nothing to compare — and it is recorded,
    // never answered from the other side's entry. Both are counted, so the log's tally is
    // the number of questions that went unanswered rather than half of it.
    if (platform.ifaces[q.key] === undefined || consumer.ifaces[q.key] === undefined) {
      uncompared.push(label(q));
      return false;
    }
    return true;
  });
  if (asked.length === 0) return { problems, uncompared };

  const keys = [...new Set(asked.map((q) => q.key))];
  let ours: ReturnType<typeof renderDts>;
  let theirs: ReturnType<typeof renderDts>;
  try {
    ours = renderDts(platform, keys);
  } catch (err) {
    // The platform's own table: a rendering fault here is ours, and the caller hears it.
    problems.push(`interface check: ${err instanceof Error ? err.message : String(err)}`);
    return { problems, uncompared };
  }
  try {
    theirs = renderDts(consumer, keys);
  } catch (err) {
    // The package's table. A platform must not take a package away from a machine for
    // something the package did not do (plugin/loader.ts), and an expression this renderer
    // cannot write is exactly that: not compared, said out loud, never a refusal.
    const why = err instanceof Error ? err.message : String(err);
    for (const q of asked) uncompared.push(`${label(q)} (${why})`);
    return { problems, uncompared };
  }
  files.set(path.join(base, "platform.d.ts"), ours.text);
  files.set(path.join(base, "consumer.d.ts"), theirs.text);
  const lines = [
    `import type * as P from "./platform.js";`,
    `import type * as C from "./consumer.js";`,
    // One question per line: the diagnostic's line number names the question.
    ...asked.map((q, n) => {
      const [from, to] =
        q.direction === "requires"
          ? [`P.${ours.names.get(q.key)}`, `C.${theirs.names.get(q.key)}`]
          : [`C.${theirs.names.get(q.key)}`, `P.${ours.names.get(q.key)}`];
      return `declare const q${n}: ${from}; export const a${n}: ${to} = q${n};`;
    }),
  ];

  const checkFile = path.join(base, "check.ts");
  files.set(checkFile, lines.join("\n") + "\n");
  const firstQuestionLine = lines.length - asked.length;
  const options: import("typescript").CompilerOptions = {
    strict: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    // The language's own library without the DOM: the rendered tables use Promise, Array,
    // AsyncIterable and the typed arrays, and parsing lib.dom.d.ts on every check is the
    // largest single cost of one.
    lib: ["lib.es2022.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  const virtual = (file: string) => files.get(path.resolve(file));
  // The files exist only here; the resolver asks about their directory before it asks about them.
  const directoryExists = host.directoryExists;
  host.directoryExists = (dir) =>
    path.resolve(dir) === base || (directoryExists?.call(host, dir) ?? true);
  host.fileExists = (file) => virtual(file) !== undefined || fileExists.call(host, file);
  host.readFile = (file) => virtual(file) ?? readFile.call(host, file);
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = virtual(file);
    return text === undefined
      ? getSourceFile.call(host, file, languageVersion, ...rest)
      : ts.createSourceFile(file, text, languageVersion, true);
  };
  const program = ts.createProgram([checkFile], options, host);
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const text = ts
      .flattenDiagnosticMessageText(d.messageText, "\n    ")
      .replace(/import\("[^"]*"(?:, \{[^}]*\{[^}]*\} \})?\)\./g, "");
    const line =
      d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : -1;
    const q =
      d.file && path.resolve(d.file.fileName) === checkFile
        ? asked[line - firstQuestionLine]
        : undefined;
    if (q === undefined) {
      problems.push(`interface check: TS${d.code} ${text}`);
      continue;
    }
    problems.push(
      `${label(q)}: ${
        q.direction === "requires"
          ? "this platform's interface does not fit the version the package was written against"
          : "the version the package was written against does not fit what this platform asks for"
      }\n    TS${d.code} ${text}`,
    );
  }
  return { problems, uncompared };
}

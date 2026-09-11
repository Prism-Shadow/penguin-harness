#!/usr/bin/env node
/**
 * gen-ifaces: project every interface class (`@Interface()`, or `extends Interface<…>()`) and every @Component
 * class of a package into the
 * kernel's signature-level form (core kernel/sig.ts) and write ONE `ifaces.json` per
 * package — the table the module-tree check (kernel/check.ts) runs over.
 *
 *   node scripts/gen-ifaces.mjs --project packages/server/tsconfig.json --out packages/server/src/ifaces.json
 *   node scripts/gen-ifaces.mjs ... --check        # CI: fail when the file on disk is stale
 *
 * The table also carries every module's manifest, read STATICALLY off its class — the
 * `@Module({...})` / `@Component({...})` literal and the `@Use` / `@Provide` / `@Bind`
 * fields, identifiers resolved to their declarations, never executed. A @Component is a
 * class that exports itself: its key is `<name>#<Class>`, its interface is its public
 * surface (members that do not project become opaque with a warning), and a bare
 * `@Use()` field typed by a component is wired to that component.
 *
 * The TS interface is the source; this file is its projection, so the two cannot drift
 (the table is generated,
 * not committed: `pnpm typecheck`, the server's `build` and `test`, and deploy.mjs all
 * regenerate it; `--check` remains for a CI that wants to assert a committed copy). Keys are `<module>#<Export>`, where the
 * module is the package name for an interface class (its identity is its structure; the
 * key only has to agree between provider and consumer) and a component's own name.
 *
 * Projection rules — the generator REFUSES what it does not recognize rather than guess:
 *   data types (primitives, literals, unions, arrays, tuples, plain objects, records)
 *     → arktype definitions; a NAMED data type (an interface without methods, a type
 *     alias) is emitted once into `types` and referenced as { "$ref": "<module>#<Name>" },
 *     which also makes a recursive type a reference to itself rather than a cut
 *   an interface WITH methods           → { iface: "<module>#<Name>" }, emitted into the table;
 *     its non-method members become `fields` (a published config object is all fields)
 *   function types                       → { fn }
 *   Promise<T> / PromiseLike<T>          → { promise }
 *   AsyncIterable<T> / AsyncGenerator<T> → { stream }
 *   void / undefined return              → { void }
 *   Opaque<"Name"> (core kernel/markers) → { opaque: "Name" } — the only by-name comparison
 *   <Name>Slots companion interface      → the slots of <Name>; a property typed Slot<D, C>
 *                                          declares a code half
 *   classes, Map/Set, generics, rest parameters, unions mixing data with non-data → error
 * A type that recurses into itself is cut at the cycle and compared by name (a warning).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const projects = args.flatMap((a, i) => (a === "--project" ? [args[i + 1]] : []));
const outPath = opt("--out");
const checkOnly = args.includes("--check");
if (projects.length === 0 || outPath === null) {
  console.error(
    "usage: gen-ifaces --project <tsconfig> [--project ...] --out <ifaces.json> [--check]",
  );
  process.exit(2);
}

const warnings = [];
const errors = [];
/** The last reason dataOf answered null, for the error that follows it. */
let notData = "";

/** module name for a source file: nearest module.json's name, else nearest package.json's name. */
const moduleNameCache = new Map();
function moduleNameOf(fileName) {
  let dir = path.dirname(fileName);
  if (moduleNameCache.has(dir)) return moduleNameCache.get(dir);
  const start = dir;
  for (;;) {
    // A module's name is the `name` of the defineModule({...}) literal in its module.ts;
    // a plugin package's is the one its package.json#penguin.modules entry names,
    // which the package name stands in for here (one module per package is the common case).
    const mts = path.join(dir, "module.ts");
    if (fs.existsSync(mts)) {
      const m =
        /(?:defineModule|manifestOf|@Module|@Component)\(\s*\{\s*"?name"?:\s*"([^"]+)"/.exec(
          fs.readFileSync(mts, "utf8"),
        );
      if (m) {
        moduleNameCache.set(start, m[1]);
        return m[1];
      }
    }
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      const name = JSON.parse(fs.readFileSync(pkg, "utf8")).name;
      moduleNameCache.set(start, name);
      return name;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no module.json or package.json above ${fileName}`);
    dir = parent;
  }
}

const table = {};
/** Named data types, keyed like interfaces; signatures reference them as { "$ref": key }. */
const types = {};
/** Module manifests, extracted STATICALLY from each module.ts's defineModule({...}) literal. */
const manifests = {};

for (const project of projects) {
  const configPath = path.resolve(project);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    },
  );
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && !sf.fileName.includes("/node_modules/"));
  /** An `@Interface()` decorator, like every other decorator here a factory call. */
  const hasInterfaceDecorator = (d) =>
    (ts.getDecorators?.(d) ?? []).some(
      (dec) =>
        ts.isCallExpression(dec.expression) &&
        ts.isIdentifier(dec.expression.expression) &&
        dec.expression.expression.text === "Interface",
    );
  /**
   * An interface handle, wherever it is declared, in either spelling: `@Interface()`
   * on a class that declares its own abstract members, or `extends Interface<…>()` for
   * an interface that IS an existing type (see core kernel/markers.ts).
   */
  const isInterfaceClassDecl = (d) =>
    ts.isClassDeclaration(d) &&
    (hasInterfaceDecorator(d) ||
      (d.heritageClauses ?? []).some((h) =>
        h.types.some(
          (t) =>
            ts.isCallExpression(t.expression) &&
            ts.isIdentifier(t.expression.expression) &&
            t.expression.expression.text === "Interface",
        ),
      ));
  /**
   * A decorated interface class must be exactly a declaration. Anything else — a base to
   * inherit members from, a constructor, a member with a body, a private one — would put
   * implementation into the contract or hide part of it, and which of the two was meant
   * is not something to guess at.
   */
  const checkDecoratedInterface = (d, file) => {
    if (!ts.isClassDeclaration(d) || !hasInterfaceDecorator(d)) return;
    const name = d.name?.text ?? "?";
    const abstract = (d.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
    if (!abstract) errors.push(`${file}: @Interface() ${name}: must be an abstract class`);
    if ((d.heritageClauses ?? []).length > 0)
      errors.push(
        `${file}: @Interface() ${name}: must not extend or implement anything — an interface that IS an existing type uses \`extends Interface<T>()\``,
      );
    for (const m of d.members) {
      const mods = m.modifiers ?? [];
      const has = (k) => mods.some((x) => x.kind === k);
      const label = m.name?.getText?.() ?? "member";
      if (ts.isConstructorDeclaration(m)) {
        errors.push(`${file}: @Interface() ${name}: must not declare a constructor`);
        continue;
      }
      if (has(ts.SyntaxKind.PrivateKeyword) || has(ts.SyntaxKind.ProtectedKeyword))
        errors.push(`${file}: @Interface() ${name}.${label}: every member is public`);
      if (has(ts.SyntaxKind.StaticKeyword))
        errors.push(`${file}: @Interface() ${name}.${label}: static members are not part of it`);
      if (!has(ts.SyntaxKind.AbstractKeyword))
        errors.push(
          `${file}: @Interface() ${name}.${label}: must be abstract — a member with a body is implementation`,
        );
    }
  };

  // Module manifests: the first argument of every defineModule(...) call, which must be a
  // pure literal — the static half that is checked before any module code runs.
  const literal = (node, file) => {
    if (ts.isObjectLiteralExpression(node)) {
      const out = {};
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          errors.push(
            `${file}:${node.getStart()}: manifest literal: only plain properties are allowed`,
          );
          continue;
        }
        const key = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : null;
        if (key === null) {
          errors.push(`${file}: manifest literal: computed property names are not allowed`);
          continue;
        }
        out[key] = literal(prop.initializer, file);
      }
      return out;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => literal(e, file));
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    )
      return literal(node.expression, file);
    errors.push(
      `${file}:${node.getStart()}: manifest literal: '${node.getText().slice(0, 40)}' is not a literal — a manifest is data`,
    );
    return null;
  };
  // Module classes: the @Module({...}) meta literal (name, contributes, context, children) plus
  // the @Use / @Provide fields, whose TYPE ANNOTATION names the interface class and whose
  // decorator argument names the providing module class. Identifiers resolve to their
  // declarations — never executed. Pass 1 collects names; pass 2 resolves references.
  const moduleClasses = new Map(); // class symbol → { node, meta, file }
  const refLiteral = (node, file) => {
    if (ts.isIdentifier(node)) {
      const sym = checker.getSymbolAtLocation(node);
      return { $id: sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const out = {};
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          errors.push(`${file}: @Module literal: only plain properties are allowed`);
          continue;
        }
        const key = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : null;
        if (key === null) {
          errors.push(`${file}: @Module literal: computed property names are not allowed`);
          continue;
        }
        out[key] = refLiteral(prop.initializer, file);
      }
      return out;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => refLiteral(e, file));
    return literal(node, file);
  };
  const decoratorCall = (node, name) => {
    for (const dec of ts.getDecorators?.(node) ?? []) {
      const call = dec.expression;
      if (
        ts.isCallExpression(call) &&
        ts.isIdentifier(call.expression) &&
        call.expression.text === name
      )
        return call;
    }
    return null;
  };
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes("/node_modules/")) continue;
    const file = path.relative(process.cwd(), sf.fileName);
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const asModule = decoratorCall(node, "Module");
        const asComponent = decoratorCall(node, "Component");
        const call = asModule ?? asComponent;
        if (asModule && asComponent)
          errors.push(`${file}: class '${node.name.text}' is both a @Module and a @Component`);
        if (call && call.arguments.length <= 1) {
          moduleClasses.set(checker.getSymbolAtLocation(node.name), {
            node,
            meta: call.arguments.length === 0 ? {} : refLiteral(call.arguments[0], file),
            file,
            kind: asModule ? "module" : "component",
            className: node.name.text,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const moduleNameBySymbol = new Map();
  /** component class symbol → its interface key: a component's name is its own module. */
  const componentKeyBySymbol = new Map();
  for (const [sym, { node, meta, file, kind, className }] of moduleClasses) {
    // A node is named by its class: `export class AuthService` is the node `AuthService`.
    if ("name" in meta) {
      errors.push(
        `${file}: @${kind === "module" ? "Module" : "Component"} meta names the node — a node is named by its class ('${className}')`,
      );
      continue;
    }
    meta.name = className;
    moduleNameBySymbol.set(sym, meta.name);
    // `export default class X` names its symbol "default"; the class keeps its own name.
    if (kind === "component")
      componentKeyBySymbol.set(sym, `${moduleNameOf(node.getSourceFile().fileName)}#${className}`);
  }
  /** interfaces with methods, by symbol → key; filled as they are met so references resolve. */
  const keys = new Map();
  const pending = [];

  // An exported interface class is keyed by the EXPORTING module (a re-export from elsewhere in
  // the package keeps that module's name); a type only reached through a signature is
  // keyed by where it is declared.
  const keyOf = (symbol, decl, exportingFile = null) => {
    if (keys.has(symbol)) return keys.get(symbol);
    const owner = exportingFile ?? decl.getSourceFile();
    const key =
      componentKeyBySymbol.get(symbol) ?? `${moduleNameOf(owner.fileName)}#${symbol.getName()}`;
    keys.set(symbol, key);
    pending.push({ symbol, decl, key });
    return key;
  };

  const where = (node) => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    return `${path.relative(process.cwd(), sf.fileName)}:${line + 1}`;
  };

  const fail = (node, message) => {
    errors.push(`${where(node)}: ${message}`);
    return { data: "unknown" };
  };

  const isMethodLike = (symbol, atNode) => {
    const t = checker.getTypeOfSymbolAtLocation(symbol, atNode);
    return t.getCallSignatures().length > 0 && t.getProperties().length === 0;
  };

  const hasMethods = (type, atNode) => type.getProperties().some((p) => isMethodLike(p, atNode));
  const hasUndefined = (type) =>
    type.isUnion() && type.types.some((t) => t.getFlags() & ts.TypeFlags.Undefined);

  const hasNull = (type) =>
    type.isUnion()
      ? type.types.some((t) => (t.getFlags() & ts.TypeFlags.Null) !== 0)
      : (type.getFlags() & ts.TypeFlags.Null) !== 0;
  /**
   * What an optional member or parameter adds is `undefined`; that is what comes off.
   * `null` is a value the contract has to keep — `x?: string | null` and `x?: string` are
   * different promises, and a provider handing back null where the consumer allows only
   * undefined must not pass. The checker can only strip both at once, so null is noted
   * here and put back on the projected definition by `orNull` / `exprOrNull`.
   */
  const sansUndefined = (type) => ({
    type: checker.getNonNullableType(type),
    nullable: type.isUnion() && hasNull(type),
  });
  const orNull = (def) =>
    typeof def === "string"
      ? def
          .split("|")
          .map((s) => s.trim())
          .includes("null")
        ? def
        : `${def}|null`
      : [def, "|", "null"];
  const exprOrNull = (expr) =>
    "data" in expr ? { ...expr, data: orNull(expr.data) } : { oneOf: [expr, { data: "null" }] };

  /**
   * A type declared by the platform (TypeScript's lib, @types/node, a dependency's .d.ts)
   * rather than by this package: compared by NAME, as `Opaque<>` would spell it — the host
   * object behind AbortSignal or Request is the same on both sides of a push, and its
   * structure is not ours to check.
   */
  /** An interface class (core kernel/markers.ts Interface) or a component: a handle, never a host object. */
  const isIfaceClass = (symbol) =>
    symbol !== undefined &&
    (componentKeyBySymbol.has(symbol) ||
      (symbol.declarations ?? []).some((d) => isInterfaceClassDecl(d)));

  const isHostDeclared = (symbol) =>
    symbol !== undefined &&
    (symbol.declarations ?? []).length > 0 &&
    symbol.declarations.every((d) => {
      const f = d.getSourceFile();
      return (
        f.isDeclarationFile &&
        (f.fileName.includes("/node_modules/") || /\/lib\.[\w.]+\.d\.ts$/.test(f.fileName))
      );
    });

  const quote = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

  /** The `types` key for a named data type, or null for an anonymous one. */
  function namedKeyOf(type) {
    const alias = type.aliasSymbol;
    const symbol = alias ?? type.getSymbol();
    if (!symbol) return null;
    const name = symbol.getName();
    if (name === "__type" || name === "__object" || name.startsWith("__")) return null;
    // Instantiated generics (OmniMessage<OmniPayload>) are named by their instantiation.
    const args = alias ? type.aliasTypeArguments : checker.getTypeArguments?.(type);
    const decl = symbol.declarations?.[0];
    if (!decl) return null;
    if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))) return null;
    const suffix =
      args && args.length > 0 ? `<${args.map((a) => checker.typeToString(a)).join(",")}>` : "";
    return `${moduleNameOf(decl.getSourceFile().fileName)}#${name}${suffix}`;
  }

  /** arktype definition for a DATA type, or null when the type is not data. */
  function dataOf(type, atNode, stack) {
    // A named data type is emitted once and referenced — so a recursive one refers to
    // itself and needs no cut. Anonymous shapes still guard on identity.
    const key = namedKeyOf(type);
    if (key !== null && !(type.getFlags() & (ts.TypeFlags.Primitive | ts.TypeFlags.Literal))) {
      if (key in types || stack.includes(type)) return { $ref: key };
      types[key] = null; // reserve: a self-reference met while projecting resolves to $ref
      const projected = projectData(type, atNode, [...stack, type]);
      if (projected === null) {
        delete types[key];
        return null;
      }
      types[key] = projected;
      return { $ref: key };
    }
    if (stack.includes(type)) {
      const label = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName() ?? "type";
      warnings.push(
        `${where(atNode)}: '${label}' is recursive; compared as unknown past the cycle`,
      );
      return "unknown";
    }
    return projectData(type, atNode, stack);
  }

  /** dataOf without the naming step. */
  function projectData(type, atNode, stack) {
    if (stack.length > 12) {
      warnings.push(
        `${where(atNode)}: '${checker.typeToString(type)}' is deeper than 12 levels; compared as unknown past that`,
      );
      return "unknown";
    }
    stack = [...stack, type];
    const f = type.getFlags();
    if (f & ts.TypeFlags.String) return "string";
    if (f & ts.TypeFlags.Number) return "number";
    if (f & ts.TypeFlags.BigInt) return "bigint";
    if (f & ts.TypeFlags.Boolean) return "boolean";
    if (f & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type);
    if (f & ts.TypeFlags.Null) return "null";
    if (f & ts.TypeFlags.Undefined) return "undefined";
    if (f & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return "unknown";
    if (f & ts.TypeFlags.Never) return "never";
    if (f & ts.TypeFlags.StringLiteral) return quote(type.value);
    if (f & ts.TypeFlags.NumberLiteral) return String(type.value);
    if (f & ts.TypeFlags.EnumLiteral && type.isUnion()) {
      return type.types.map((t) => dataOf(t, atNode, stack)).join("|");
    }
    if (type.isUnion()) {
      const parts = type.types.map((t) => dataOf(t, atNode, stack));
      if (parts.some((p) => p === null)) {
        notData = `member of '${checker.typeToString(type)}': ${notData || "not data"}`;
        return null;
      }
      // Collapse `true | false` back to boolean and keep string-only unions readable.
      if (parts.every((p) => typeof p === "string")) {
        const set = new Set(parts);
        if (set.has("true") && set.has("false")) {
          set.delete("true");
          set.delete("false");
          set.add("boolean");
        }
        return [...set].join("|");
      }
      return parts.slice(1).reduce((acc, p) => [acc, "|", p], parts[0]);
    }
    if (type.isIntersection()) {
      const opaque = type.types.find((t) => t.getProperty("__opaque"));
      if (opaque) {
        notData = `'${checker.typeToString(type)}' is opaque`;
        return null; // handled as opaque by exprOf
      }
      const parts = type.types.map((t) => dataOf(t, atNode, stack));
      if (parts.some((p) => p === null)) {
        notData = `part of '${checker.typeToString(type)}': ${notData || "not data"}`;
        return null;
      }
      return parts.slice(1).reduce((acc, p) => [acc, "&", p], parts[0]);
    }
    if (f & ts.TypeFlags.TypeParameter) {
      // Erased: a type parameter has no wire form, so the contract says `unknown` here.
      warnings.push(
        `${where(atNode)}: type parameter '${checker.typeToString(type)}' erased to unknown`,
      );
      return "unknown";
    }
    if (f & ts.TypeFlags.Object) {
      const symbol = type.getSymbol();
      const name = symbol?.getName();
      if (name === "Date") return "Date";
      if (checker.isArrayType(type) || name === "ReadonlyArray") {
        const elem = checker.getTypeArguments(type)[0];
        const inner = dataOf(elem, atNode, stack);
        if (inner === null) {
          notData = `element of '${checker.typeToString(type)}': ${notData || "not data"}`;
          return null;
        }
        return typeof inner === "string" && /^[\w'|]+$/.test(inner) ? `${inner}[]` : [inner, "[]"];
      }
      if (checker.isTupleType(type)) {
        const elems = checker.getTypeArguments(type).map((t) => dataOf(t, atNode, stack));
        if (elems.some((e) => e === null)) {
          notData = `tuple element: ${notData || "not data"}`;
          return null;
        }
        return elems;
      }
      if (name === "Map" || name === "Set" || name === "WeakMap") {
        fail(atNode, `${name} has no wire form; use an array or a record`);
        return "unknown";
      }
      if (type.getCallSignatures().length > 0) {
        notData = `'${checker.typeToString(type)}' is a function`;
        return null;
      }
      // A host-declared object with behavior is opaque (exprOf); a host-declared plain
      // shape ({ x: number } from a .d.ts) is data like any other.
      if (
        isHostDeclared(symbol) &&
        (symbol.flags & ts.SymbolFlags.Class || hasMethods(type, atNode))
      ) {
        notData = `'${name}' is a host object`;
        return null;
      }
      if (symbol && symbol.flags & ts.SymbolFlags.Class) {
        if (isIfaceClass(symbol)) {
          notData = `'${name}' is an interface class`;
          return null;
        }
        fail(atNode, `class '${name}' cannot be a data type; wrap it as Opaque<"${name}">`);
        return "unknown";
      }
      if (hasMethods(type, atNode)) {
        notData = `'${checker.typeToString(type)}' has methods`;
        return null;
      }
      const next = stack;
      const out = {};
      const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String);
      if (stringIndex) {
        const v = dataOf(stringIndex.type, atNode, next);
        if (v === null) {
          notData = `${name ?? "object"}.[string]: ${notData || checker.typeToString(stringIndex.type)}`;
          return null;
        }
        out["[string]"] = v;
      }
      for (const prop of type.getProperties()) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, atNode);
        // `x?: T` reads as `T | undefined` under strictNullChecks; an instantiated property
        // may carry the union without the Optional flag, so the union is the test.
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 || hasUndefined(propType);
        const { type: kept, nullable } = optional
          ? sansUndefined(propType)
          : { type: propType, nullable: false };
        let v = dataOf(kept, atNode, next);
        if (v === null) {
          notData = `${name ?? "object"}.${prop.getName()}: ${notData || `'${checker.typeToString(propType)}' flags=${propType.getFlags()} sym=${propType.getSymbol()?.getName()}`}`;
          return null;
        }
        if (nullable) v = orNull(v);
        out[optional ? `${prop.getName()}?` : prop.getName()] = v;
      }
      return out;
    }
    notData = `'${checker.typeToString(type)}' (flags ${type.getFlags()}) has no data form`;
    return null;
  }

  function opaqueName(type) {
    const prop = type.getProperty("__opaque");
    if (!prop) return null;
    const t = checker.getNonNullableType(checker.getTypeOfSymbol(prop));
    return t.isStringLiteral() ? t.value : null;
  }

  /** TypeExpr for any type in a signature position. */
  function exprOf(type, atNode, stack = []) {
    notData = "";
    const f = type.getFlags();
    if (f & ts.TypeFlags.Void) return { void: true };
    const opaque = opaqueName(type);
    if (opaque !== null) return { opaque };
    const symbol = type.getSymbol();
    const name = symbol?.getName();
    if (name === "Promise" || name === "PromiseLike") {
      return { promise: exprOf(checker.getTypeArguments(type)[0], atNode, stack) };
    }
    if (name === "AsyncIterable" || name === "AsyncIterableIterator" || name === "AsyncGenerator") {
      const [t, r] = checker.getTypeArguments(type);
      const out = { stream: exprOf(t, atNode, stack) };
      if (
        name === "AsyncGenerator" &&
        r &&
        !(r.getFlags() & (ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Unknown))
      ) {
        out.returns = exprOf(r, atNode, stack);
      }
      return out;
    }
    const data = dataOf(type, atNode, stack);
    if (data !== null) return { data };
    if (type.isUnion()) {
      // T | null | undefined around a non-data T: `undefined` is absence (`maybe`), `null`
      // is a value and stays a member.
      const rest = type.types.filter(
        (t) => !(t.getFlags() & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)),
      );
      const absent = type.types.some((t) => (t.getFlags() & ts.TypeFlags.Undefined) !== 0);
      if (rest.length > 0) {
        const members = rest.map((t) => exprOf(t, atNode, stack));
        if (hasNull(type)) members.push({ data: "null" });
        const inner = members.length === 1 ? members[0] : { oneOf: members };
        return absent ? { maybe: inner } : inner;
      }
      return fail(
        atNode,
        `union '${checker.typeToString(type)}' mixes data with a function, promise or interface (${notData})`,
      );
    }
    const sigs = type.getCallSignatures();
    if (sigs.length === 1 && type.getProperties().length === 0) {
      return { fn: sigOf(sigs[0], atNode, stack) };
    }
    if (f & ts.TypeFlags.Object) {
      if (checker.isArrayType(type)) {
        return { array: exprOf(checker.getTypeArguments(type)[0], atNode, stack) };
      }
      if (checker.isTupleType(type)) {
        return fail(
          atNode,
          `tuple '${checker.typeToString(type)}' holds a non-data element (${notData})`,
        );
      }
      if (isHostDeclared(symbol)) return { opaque: name };
      // A plain object shape some member of which is not data (a Buffer field, a callback
      // property): structured, compared member by member.
      if (
        !hasMethods(type, atNode) &&
        !(symbol && symbol.flags & ts.SymbolFlags.Class) &&
        !stack.includes(type)
      ) {
        const members = {};
        const optional = [];
        for (const prop of type.getProperties()) {
          const t = checker.getTypeOfSymbolAtLocation(prop, atNode);
          const opt = (prop.flags & ts.SymbolFlags.Optional) !== 0 || hasUndefined(t);
          if (opt) optional.push(prop.getName());
          const { type: kept, nullable } = opt ? sansUndefined(t) : { type: t, nullable: false };
          const e = exprOf(kept, prop.valueDeclaration ?? atNode, [...stack, type]);
          members[prop.getName()] = nullable ? exprOrNull(e) : e;
        }
        return optional.length > 0 ? { object: members, optional } : { object: members };
      }
      if (symbol && symbol.flags & ts.SymbolFlags.Class && !isIfaceClass(symbol)) {
        return fail(atNode, `class '${name}' in a signature: wrap it as Opaque<"${name}">`);
      }
      if (hasMethods(type, atNode) || isIfaceClass(symbol)) {
        const decl = symbol?.declarations?.find(
          (d) =>
            ts.isInterfaceDeclaration(d) ||
            ts.isTypeAliasDeclaration(d) ||
            ts.isClassDeclaration(d),
        );
        if (!decl)
          return fail(atNode, `anonymous object with methods; declare it as an exported interface`);
        return { iface: keyOf(symbol, decl) };
      }
    }
    return fail(atNode, `unsupported type '${checker.typeToString(type)}' (${notData})`);
  }

  function sigOf(signature, atNode, stack) {
    if (signature.getTypeParameters()?.length) {
      warnings.push(
        `${where(atNode)}: generic method — its type parameters are erased to unknown in the contract`,
      );
    }
    const params = signature.getParameters().map((p) => {
      const decl = p.valueDeclaration;
      if (decl && ts.isParameter(decl) && decl.dotDotDotToken) {
        fail(decl, "rest parameters are not allowed on an interface");
      }
      const t = checker.getTypeOfSymbolAtLocation(p, atNode);
      const optional =
        decl &&
        ts.isParameter(decl) &&
        (decl.questionToken !== undefined || decl.initializer !== undefined);
      const { type: kept, nullable } = optional ? sansUndefined(t) : { type: t, nullable: false };
      let expr = exprOf(kept, decl ?? atNode, stack);
      if (nullable) expr = exprOrNull(expr);
      if (optional) {
        if (!("data" in expr)) return { maybe: expr };
        expr.data =
          typeof expr.data === "string" && !expr.data.includes("undefined")
            ? `${expr.data}|undefined`
            : [expr.data, "|", "undefined"];
      }
      return expr;
    });
    return { params, returns: exprOf(signature.getReturnType(), atNode, stack) };
  }

  const LIFECYCLE = new Set(["setup", "park", "migrations"]);
  /** A member of a component class that is not part of its interface. */
  const isHiddenMember = (prop) => {
    const d = prop.valueDeclaration;
    if (!d) return false;
    const flags = ts.getCombinedModifierFlags(d);
    if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static))
      return true;
    if (ts.isPrivateIdentifier(d.name)) return true;
    if (LIFECYCLE.has(prop.getName())) return true;
    return ["Use", "Provide", "Bind"].some((n) => decoratorCall(d, n));
  };
  function ifaceOf(symbol, decl) {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const key = componentKeyBySymbol.get(symbol);
    const component = key !== undefined;
    const methods = {};
    const fields = {};
    // A component's interface is whatever of its public surface projects; a member that
    // does not is opaque (compared by name only) with a warning, since a consumer that
    // never names it loses nothing and one that does will see the mismatch.
    const tolerant = (prop, project) => {
      if (!component) return project();
      const mark = errors.length;
      const out = project();
      if (errors.length === mark) return out;
      const why = errors.splice(mark).map((e) => e.slice(e.indexOf(": ") + 2));
      warnings.push(
        `${where(prop.valueDeclaration ?? decl)}: component member '${prop.getName()}' is opaque in the contract (${why.join("; ")})`,
      );
      return { opaque: `${symbol.getName()}.${prop.getName()}` };
    };
    for (const prop of type.getProperties()) {
      if (component && isHiddenMember(prop)) continue;
      if (!isMethodLike(prop, decl)) {
        const t = checker.getTypeOfSymbolAtLocation(prop, decl);
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0 || hasUndefined(t);
        const { type: kept, nullable } = optional ? sansUndefined(t) : { type: t, nullable: false };
        const projected = tolerant(prop, () => exprOf(kept, prop.valueDeclaration ?? decl, [type]));
        const expr = nullable ? exprOrNull(projected) : projected;
        // An optional field may be absent on the instance; the consumer sees a `maybe`.
        fields[prop.getName()] = optional && !("maybe" in expr) ? { maybe: expr } : expr;
        continue;
      }
      const t = checker.getTypeOfSymbolAtLocation(prop, decl);
      const sigs = t.getCallSignatures();
      if (sigs.length !== 1) {
        tolerant(prop, () =>
          fail(
            prop.valueDeclaration ?? decl,
            `method '${prop.getName()}' has ${sigs.length} overloads; one signature per method`,
          ),
        );
        continue;
      }
      const sig = tolerant(prop, () => sigOf(sigs[0], prop.valueDeclaration ?? decl, [type]));
      if ("opaque" in sig) fields[prop.getName()] = sig;
      else methods[prop.getName()] = sig;
    }
    const out = { name: component ? key.slice(key.indexOf("#") + 1) : symbol.getName(), methods };
    if (Object.keys(fields).length > 0) out.fields = fields;
    out.slots = {};
    return out;
  }

  function slotsOf(symbol, decl) {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const slots = {};
    for (const prop of type.getProperties()) {
      const t = checker.getTypeOfSymbolAtLocation(prop, decl);
      const at = prop.valueDeclaration ?? decl;
      const isSlot =
        t.getSymbol()?.getName() === "Slot" && t.getProperty("data") && t.getProperty("code");
      if (isSlot) {
        const data = dataOf(checker.getTypeOfSymbol(t.getProperty("data")), at, []);
        if (data === null) {
          fail(at, `slot '${prop.getName()}': the data half must be a data type`);
          continue;
        }
        const codeType = checker.getTypeOfSymbol(t.getProperty("code"));
        const slot = { data };
        if (!(codeType.getFlags() & ts.TypeFlags.Never)) slot.code = exprOf(codeType, at, []);
        slots[prop.getName()] = slot;
      } else {
        const data = dataOf(t, at, []);
        if (data === null) {
          fail(
            at,
            `slot '${prop.getName()}' must be a data type, or Slot<Data, Code> for a code half`,
          );
          continue;
        }
        slots[prop.getName()] = { data };
      }
    }
    return slots;
  }

  // Every exported interface class (either spelling) anywhere in the package is
  // a table entry, and an exported `<Name>Slots` interface beside one names its slots;
  // everything else is a data type, reached only through references.
  const slotCompanions = [];
  for (const sf of sourceFiles) {
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exp of checker.getExportsOfModule(moduleSymbol)) {
      // A re-export (`export type { X } from "..."`) is an alias; follow it to the declaration.
      const symbol = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      const decl = symbol.declarations?.[0];
      if (!decl) continue;
      const name = symbol.getName();
      if (ts.isInterfaceDeclaration(decl) && name.endsWith("Slots")) {
        slotCompanions.push({ symbol, decl, owner: name.slice(0, -"Slots".length), sf });
        continue;
      }
      if (!isInterfaceClassDecl(decl)) continue;
      checkDecoratedInterface(decl, path.relative(process.cwd(), sf.fileName));
      keyOf(symbol, decl, sf);
    }
  }
  for (const [sym, { node }] of moduleClasses) if (componentKeyBySymbol.has(sym)) keyOf(sym, node);
  while (pending.length > 0) {
    const { symbol, decl, key } = pending.shift();
    table[key] = ifaceOf(symbol, decl);
  }
  const ifaceKeyOfType = (typeNode, file) => {
    const sym0 =
      typeNode && ts.isTypeReferenceNode(typeNode)
        ? checker.getSymbolAtLocation(typeNode.typeName)
        : undefined;
    const sym = sym0 && sym0.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym0) : sym0;
    if (sym && componentKeyBySymbol.has(sym)) return componentKeyBySymbol.get(sym);
    const decl = sym?.declarations?.find((d) => isInterfaceClassDecl(d));
    if (!decl) {
      errors.push(
        `${file}: a @Use/@Provide field's type must be a @Component class or an interface class (@Interface(), or extends Interface<…>()) (got '${typeNode?.getText() ?? "?"}')`,
      );
      return "?";
    }
    return `${moduleNameOf(decl.getSourceFile().fileName)}#${sym.getName()}`;
  };
  /** The component a bare `@Use()` field is wired to: the one its type names, if any. */
  const componentOfType = (typeNode) => {
    const sym0 =
      typeNode && ts.isTypeReferenceNode(typeNode)
        ? checker.getSymbolAtLocation(typeNode.typeName)
        : undefined;
    const sym = sym0 && sym0.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym0) : sym0;
    return sym && componentKeyBySymbol.has(sym) ? moduleNameBySymbol.get(sym) : undefined;
  };
  for (const [sym, { node, meta, file, kind, className }] of moduleClasses) {
    const m = {
      name: meta.name,
      requires: {},
      provides: {},
      contributes: meta.contributes ?? {},
      children: [],
    };
    if (meta.context !== undefined) m.context = meta.context;
    if (kind === "component") {
      m.provides[className] = componentKeyBySymbol.get(sym);
      if (meta.children !== undefined)
        errors.push(`${file}: a @Component has no children — it exports itself`);
    }
    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name) continue;
      const field = ts.isIdentifier(member.name)
        ? member.name.text
        : ts.isStringLiteral(member.name)
          ? member.name.text
          : null;
      if (field === null) continue;
      const use = decoratorCall(member, "Use");
      if (use) {
        const req = { iface: ifaceKeyOfType(member.type, file) };
        if (use.arguments.length > 0) {
          const ref = refLiteral(use.arguments[0], file);
          const fromName = moduleNameBySymbol.get(ref?.$id);
          if (fromName === undefined)
            errors.push(
              `${file}: @Use(${use.arguments[0].getText()}) on '${field}': not a @Module class`,
            );
          req.from = fromName ?? "?";
        } else {
          const from = componentOfType(member.type);
          if (from !== undefined) req.from = from;
        }
        m.requires[field] = req;
      }
      if (decoratorCall(member, "Provide")) {
        if (kind === "component")
          errors.push(`${file}: @Provide on a @Component: a component exports only itself`);
        m.provides[field] = ifaceKeyOfType(member.type, file);
      }
    }
    for (const child of meta.children ?? []) {
      const childName = moduleNameBySymbol.get(child?.$id);
      if (childName === undefined)
        errors.push(`${file}: children: an entry is not a @Module or @Component class`);
      m.children.push(childName ?? "?");
    }
    if (manifests[m.name]) errors.push(`${file}: module '${m.name}' is defined twice`);
    manifests[m.name] = m;
  }
  for (const { symbol, decl, owner, sf } of slotCompanions) {
    const ownerExp = checker
      .getExportsOfModule(checker.getSymbolAtLocation(sf))
      .find((e) => e.getName() === owner);
    const ownerSym =
      ownerExp &&
      (ownerExp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ownerExp) : ownerExp);
    const key = ownerSym && keys.get(ownerSym);
    if (!key || !table[key]) {
      errors.push(
        `${where(decl)}: '${symbol.getName()}' has no interface '${owner}' in the same module to attach to`,
      );
      continue;
    }
    table[key].slots = slotsOf(symbol, decl);
  }
}

for (const w of warnings) console.warn(`gen-ifaces: warning: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`gen-ifaces: error: ${e}`);
  process.exit(1);
}

const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
// The table's identity: a sha256 over its canonical content, so two builds can tell at
// a glance whether they agree on every interface and manifest (the page CI publishes
// carries it, and a pre-push check compares it). The hash is not part of what it hashes.
const body = { ifaces: sortKeys(table), types: sortKeys(types), modules: sortKeys(manifests) };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
const text = `${JSON.stringify({ hash, ...body }, null, 1)}\n`;
const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : null;
if (checkOnly) {
  if (existing !== text) {
    console.error(`gen-ifaces: ${outPath} is stale — run \`pnpm gen:ifaces\``);
    process.exit(1);
  }
  console.log(
    `gen-ifaces: ${outPath} is up to date (${Object.keys(table).length} interfaces, ${Object.keys(types).length} types)`,
  );
} else if (existing !== text) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  console.log(
    `gen-ifaces: wrote ${outPath} (${Object.keys(table).length} interfaces, ${Object.keys(types).length} types)`,
  );
} else {
  console.log(
    `gen-ifaces: ${outPath} unchanged (${Object.keys(table).length} interfaces, ${Object.keys(types).length} types)`,
  );
}

#!/usr/bin/env node
/**
 * ui-migrate: rewrite the imports of modules that moved out of the Web App into the shared UI
 * package (`@prismshadow/penguin-ui`), or into a web module that took part of one over, across
 * the Web App and the gallery.
 *
 *   node scripts/ui-migrate.mjs             rewrite in place
 *   node scripts/ui-migrate.mjs --dry-run   list the files it would change, write nothing
 *   node scripts/ui-migrate.mjs --check     like --dry-run, and exit 1 when anything would change
 *
 * The map is scripts/ui-migrate.json: per wave, per web module (repo-relative, no extension), a
 * list of rules `{ target, dest, names }`. `target` is the package, or a web module (repo-relative,
 * the specifier computed per file); `dest` is the file that defines the names afterwards. A name
 * is `Name` (moved as is), `Old→New` (renamed: the import and every reference follow) or
 * `OLD→OBJECT.key` (became a member of a registry object: the import becomes `OBJECT` and every
 * reference `OBJECT.key`).
 *
 * A rule applies to a name once the web module no longer exports it (the module is deleted, or
 * the name left it) and `dest` exports what it maps to. So a work package runs the script after
 * moving its modules, and it touches exactly what that package moved; the same run on a rebased
 * branch redoes every package's rewrites instead of anyone resolving import conflicts. Running it
 * twice is a no-op.
 *
 * Every `.ts`/`.tsx` under packages/web/{src,test} and packages/ui-gallery/{src,test} is read.
 * An import (value or type) of a listed module has its moved names taken out — the declaration
 * is dropped when nothing is left — and put on the target: merged into the file's existing
 * import of it, or on a new line (the package's after the file's last bare-specifier import
 * ahead of its first relative one; a web module's where the old import stood). Type-only names
 * go on an `import type` line. What the script cannot do on its own it prints and leaves alone:
 * a name the module no longer exports with no rule for it, a local binding a new import would
 * collide with, a re-export, a namespace or default import. Those are the hand edits.
 *
 * Parsing uses the repo's `typescript`. In a checkout without node_modules, point
 * UI_MIGRATE_TYPESCRIPT at an installed typescript package directory.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_FILE = path.join(ROOT, "scripts", "ui-migrate.json");
const PACKAGE = "@prismshadow/penguin-ui";
const SCAN_ROOTS = [
  "packages/web/src",
  "packages/web/test",
  "packages/ui-gallery/src",
  "packages/ui-gallery/test",
];
/** Prettier's printWidth here: an import longer than this is written one name per line. */
const PRINT_WIDTH = 100;

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run") || args.has("--check");
const CHECK = args.has("--check");

const ts = loadTypescript();

function loadTypescript() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const override = process.env.UI_MIGRATE_TYPESCRIPT;
  try {
    return override ? require(path.resolve(override)) : require("typescript");
  } catch {
    console.error(
      "ui-migrate: cannot load typescript. Run `pnpm install`, or set UI_MIGRATE_TYPESCRIPT " +
        "to an installed typescript package directory (…/node_modules/typescript).",
    );
    process.exit(2);
  }
}

const posix = (p) => p.split(path.sep).join("/");
const repoRel = (abs) => posix(path.relative(ROOT, abs));

function parse(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

// ---------------------------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------------------------

const NAME = /^([A-Za-z_$][\w$]*)(?:\s*(?:→|->)\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?)?$/;

/** module id → { rules: [{ owner, target, dest, entries: Map<old, entry> }] } */
function loadMap() {
  const raw = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  const modules = new Map();
  for (const [wave, byModule] of Object.entries(raw.waves ?? {})) {
    for (const [moduleId, rules] of Object.entries(byModule)) {
      const list = modules.get(moduleId) ?? [];
      for (const rule of Array.isArray(rules) ? rules : [rules]) {
        const entries = new Map();
        for (const spec of rule.names) {
          const m = NAME.exec(spec.trim());
          if (!m) throw new Error(`ui-migrate.json: ${wave} ${moduleId}: bad name "${spec}"`);
          const [, old, to, key] = m;
          entries.set(
            old,
            key !== undefined
              ? { old, kind: "member", name: to, key }
              : { old, kind: to === undefined || to === old ? "same" : "rename", name: to ?? old },
          );
        }
        list.push({ wave, owner: rule.owner, target: rule.target, dest: rule.dest, entries });
      }
      modules.set(moduleId, list);
    }
  }
  return modules;
}

/** The file behind a module id, or null when it is gone. */
function moduleFile(moduleId) {
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const abs = path.join(ROOT, moduleId + ext);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const exportCache = new Map();

/**
 * What a module file exports: its names, whether it re-exports a whole module (then any name may
 * be exported), and the keys of each exported object literal (a registry's members).
 */
function exportsOf(abs) {
  if (exportCache.has(abs)) return exportCache.get(abs);
  const sf = parse(abs, fs.readFileSync(abs, "utf8"));
  const names = new Set();
  const keys = new Map();
  let star = false;
  const exported = (node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) star = true;
      else if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) names.add(el.name.text);
      }
    } else if (ts.isVariableStatement(st) && exported(st)) {
      for (const decl of st.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        names.add(decl.name.text);
        let init = decl.initializer;
        while (
          init &&
          (ts.isAsExpression(init) ||
            ts.isSatisfiesExpression(init) ||
            ts.isParenthesizedExpression(init))
        ) {
          init = init.expression;
        }
        if (init && ts.isObjectLiteralExpression(init)) {
          keys.set(
            decl.name.text,
            new Set(
              init.properties
                .map((p) => p.name)
                .filter((n) => n && (ts.isIdentifier(n) || ts.isStringLiteral(n)))
                .map((n) => n.text),
            ),
          );
        }
      }
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      exported(st) &&
      st.name
    ) {
      names.add(st.name.text);
    }
  }
  const result = { names, star, keys };
  exportCache.set(abs, result);
  return result;
}

/**
 * Each rule's entries split by state: `active` (the module let the name go and `dest` has it),
 * `blocked` (the name left but `dest` cannot take it — printed), or pending (left out: the module
 * still exports it, so its work package has not moved it yet).
 */
function resolveRules(modules) {
  const resolved = new Map();
  const blocked = [];
  let pending = 0;
  for (const [moduleId, rules] of modules) {
    const file = moduleFile(moduleId);
    const source = file ? exportsOf(file) : null;
    const active = new Map();
    for (const rule of rules) {
      const destAbs = path.join(ROOT, rule.dest);
      const dest = fs.existsSync(destAbs) ? exportsOf(destAbs) : null;
      for (const entry of rule.entries.values()) {
        if (source && (source.star || source.names.has(entry.old))) {
          pending++;
          continue;
        }
        const why =
          dest === null
            ? `${rule.dest} does not exist`
            : !dest.names.has(entry.name) && !dest.star
              ? `${rule.dest} does not export ${entry.name}`
              : entry.kind === "member" && !dest.keys.get(entry.name)?.has(entry.key)
                ? `${entry.name} in ${rule.dest} has no key ${entry.key}`
                : null;
        if (why !== null) {
          blocked.push(`${moduleId}: ${entry.old} → ${rule.target}: ${why}`);
          continue;
        }
        active.set(entry.old, { ...entry, target: rule.target });
      }
    }
    resolved.set(moduleId, { gone: file === null, source, active });
  }
  return { resolved, blocked, pending };
}

// ---------------------------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------------------------

/** The module id a relative specifier names from `file`, or null for a bare specifier. */
function moduleIdOf(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  return repoRel(path.resolve(path.dirname(file), specifier)).replace(/\.(?:tsx?|jsx?|mjs)$/, "");
}

/** The specifier `file` uses for a target: the package, or a relative path to a web module. */
function specifierFor(file, target) {
  if (!target.startsWith("packages/")) return target;
  let rel = posix(path.relative(path.dirname(file), path.join(ROOT, target)));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** An import specifier's text: `type A`, `A as B`. */
function specifierText({ imported, local, typeOnly }) {
  return `${typeOnly ? "type " : ""}${imported === local ? imported : `${imported} as ${local}`}`;
}

function renderImport(specifiers, from, typeOnly) {
  const head = typeOnly ? "import type " : "import ";
  const one = `${head}{ ${specifiers.join(", ")} } from "${from}";`;
  if (one.length <= PRINT_WIDTH) return one;
  return `${head}{\n${specifiers.map((s) => `  ${s},`).join("\n")}\n} from "${from}";`;
}

const byImported = (a, b) => (a.imported < b.imported ? -1 : a.imported > b.imported ? 1 : 0);

function elementsOf(decl) {
  const clause = decl.importClause;
  return clause.namedBindings.elements.map((el) => ({
    imported: (el.propertyName ?? el.name).text,
    local: el.name.text,
    typeOnly: el.isTypeOnly,
  }));
}

/** Every name the file binds anywhere, with the import declaration it comes from (if any). */
function bindingsOf(sf) {
  const bound = new Map();
  const add = (name, decl) => {
    const list = bound.get(name) ?? [];
    list.push(decl);
    bound.set(name, list);
  };
  const addPattern = (name) => {
    if (ts.isIdentifier(name)) add(name.text, null);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) addPattern(el.name);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.name) add(clause.name.text, node);
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) add(nb.name.text, node);
      else if (nb) for (const el of nb.elements) add(el.name.text, node);
      return;
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      node.name
    ) {
      addPattern(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isTypeParameterDeclaration(node)) &&
      node.name
    ) {
      add(node.name.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bound;
}

/** Identifier references to rewrite: `local → replacement`, skipping names that are not references. */
function referenceEdits(sf, rewrites, problems, file) {
  const edits = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && rewrites.has(node.text)) {
      const parent = node.parent;
      const replacement = rewrites.get(node.text);
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        ts.isJsxAttribute(parent) ||
        (ts.isEnumMember(parent) && parent.name === node);
      if (ts.isExportSpecifier(parent)) {
        problems.push(`${file}: re-exports ${node.text}; rewrite the export by hand`);
      } else if (ts.isShorthandPropertyAssignment(parent)) {
        edits.push({
          start: node.getStart(sf),
          end: node.end,
          text: `${node.text}: ${replacement}`,
        });
      } else if (!isName) {
        edits.push({ start: node.getStart(sf), end: node.end, text: replacement });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edits;
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const edit of sorted) {
    if (edit.end > floor) throw new Error(`overlapping edits at ${edit.start}`);
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

/** The line-inclusive range of a statement: from its first token to the newline after it. */
function statementRange(text, sf, node) {
  const start = node.getStart(sf);
  let end = node.end;
  if (text[end] === "\r") end++;
  if (text[end] === "\n") end++;
  return { start, end };
}

function migrateFile(file, resolved, problems) {
  const text = fs.readFileSync(file, "utf8");
  const sf = parse(file, text);
  const rel = repoRel(file);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const moves = [];
  const touched = [];

  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier) continue;
    const id = moduleIdOf(file, st.moduleSpecifier.text);
    if (id && resolved.get(id)?.active.size) {
      problems.push(`${rel}: re-exports from ${st.moduleSpecifier.text}; rewrite it by hand`);
    }
  }

  for (const decl of imports) {
    const id = moduleIdOf(file, decl.moduleSpecifier.text);
    const state = id ? resolved.get(id) : undefined;
    if (!state) continue;
    const clause = decl.importClause;
    const named = clause?.namedBindings;
    if (!clause || clause.name || (named && ts.isNamespaceImport(named))) {
      if (state.active.size > 0 || state.gone) {
        problems.push(`${rel}: a default, namespace or bare import of ${id}; move it by hand`);
      }
      continue;
    }
    if (!named) continue;
    const keep = [];
    const moved = [];
    for (const el of elementsOf(decl)) {
      const entry = state.active.get(el.imported);
      const typeOnly = clause.isTypeOnly || el.typeOnly;
      if (entry) {
        moved.push({ ...el, typeOnly, entry });
        continue;
      }
      keep.push(el);
      const exported = state.source && (state.source.star || state.source.names.has(el.imported));
      if (!exported) {
        problems.push(
          `${rel}: ${el.imported} from ${decl.moduleSpecifier.text} — ${id} no longer exports it and no rule maps it`,
        );
      }
    }
    if (moved.length === 0) continue;
    touched.push({ decl, keep, typeOnly: clause.isTypeOnly });
    for (const m of moved) moves.push({ ...m, decl });
  }
  if (moves.length === 0) return null;

  // What each move adds to its target, and which references change.
  const rewrites = new Map();
  const additions = new Map(); // `${target}|${typeOnly}` → { target, typeOnly, specifiers: Map<local, spec>, anchor }
  for (const m of moves) {
    const { entry } = m;
    let spec;
    if (entry.kind === "member") {
      spec = { imported: entry.name, local: entry.name, typeOnly: false };
      rewrites.set(m.local, `${entry.name}.${entry.key}`);
    } else if (entry.kind === "rename" && m.local === m.imported) {
      spec = { imported: entry.name, local: entry.name, typeOnly: m.typeOnly };
      rewrites.set(m.local, entry.name);
    } else {
      spec = { imported: entry.name, local: m.local, typeOnly: m.typeOnly };
    }
    const typeOnly = spec.typeOnly;
    const key = `${entry.target}|${typeOnly}`;
    const add = additions.get(key) ?? {
      target: entry.target,
      typeOnly,
      specifiers: new Map(),
      anchor: m.decl,
    };
    // A type-only name on a value line would be written `type X`; the line itself is typed.
    add.specifiers.set(spec.local, { ...spec, typeOnly: false });
    additions.set(key, add);
  }

  // Collisions: a new local name the file already binds to something else, or an old name
  // that the file also binds elsewhere (a shadow the reference rewrite would walk into).
  const bound = bindingsOf(sf);
  const movedDecls = new Set(moves.map((m) => m.decl));
  for (const add of additions.values()) {
    const from = specifierFor(file, add.target);
    for (const local of add.specifiers.keys()) {
      const others = (bound.get(local) ?? []).filter(
        (d) =>
          !(d && movedDecls.has(d)) &&
          !(
            d &&
            (d.moduleSpecifier.text === from ||
              (add.target.startsWith("packages/") &&
                moduleIdOf(file, d.moduleSpecifier.text) === add.target))
          ),
      );
      if (others.length > 0) {
        problems.push(`${rel}: ${local} is already bound in this file; rename the local first`);
        return null;
      }
    }
  }
  for (const local of rewrites.keys()) {
    const others = (bound.get(local) ?? []).filter((d) => !(d && movedDecls.has(d)));
    if (others.length > 0) {
      problems.push(`${rel}: ${local} is also declared locally; rewrite its references by hand`);
      return null;
    }
  }

  const edits = referenceEdits(sf, rewrites, problems, rel);

  // Old declarations: re-render with what stays, or drop.
  const dropped = new Map();
  for (const { decl, keep, typeOnly } of touched) {
    if (keep.length > 0) {
      edits.push({
        start: decl.getStart(sf),
        end: decl.end,
        text: renderImport(keep.map(specifierText), decl.moduleSpecifier.text, typeOnly),
      });
    } else {
      const range = statementRange(text, sf, decl);
      const edit = { ...range, text: "" };
      dropped.set(decl, edit);
      edits.push(edit);
    }
  }

  // New names: merged into an existing import of the target, else a new line.
  const bare = [];
  for (const decl of imports) {
    if (decl.moduleSpecifier.text.startsWith(".")) break;
    bare.push(decl);
  }
  const packageLines = [];
  const anchored = new Map();
  for (const add of [...additions.values()].sort(
    (a, b) => Number(a.typeOnly) - Number(b.typeOnly),
  )) {
    const from = specifierFor(file, add.target);
    const existing = imports.find((d) => {
      const c = d.importClause;
      if (!c || c.name || !c.namedBindings || ts.isNamespaceImport(c.namedBindings)) return false;
      if (Boolean(c.isTypeOnly) !== add.typeOnly || movedDecls.has(d)) return false;
      return add.target.startsWith("packages/")
        ? moduleIdOf(file, d.moduleSpecifier.text) === add.target
        : d.moduleSpecifier.text === add.target;
    });
    const specs = new Map(add.specifiers);
    if (existing) {
      for (const el of elementsOf(existing)) specs.set(el.local, el);
      edits.push({
        start: existing.getStart(sf),
        end: existing.end,
        text: renderImport(
          [...specs.values()].sort(byImported).map(specifierText),
          existing.moduleSpecifier.text,
          add.typeOnly,
        ),
      });
      continue;
    }
    const line = renderImport(
      [...specs.values()].sort(byImported).map(specifierText),
      from,
      add.typeOnly,
    );
    if (add.target === PACKAGE || !add.target.startsWith("packages/")) {
      packageLines.push(line);
    } else if (dropped.has(add.anchor)) {
      dropped.get(add.anchor).text += `${line}\n`;
    } else {
      const after = anchored.get(add.anchor) ?? [];
      after.push(line);
      anchored.set(add.anchor, after);
    }
  }
  for (const [anchor, lines] of anchored) {
    const { end } = statementRange(text, sf, anchor);
    edits.push({ start: end, end, text: lines.map((l) => `${l}\n`).join("") });
  }
  if (packageLines.length > 0) {
    const after = bare.at(-1);
    if (after) {
      edits.push({ start: after.end, end: after.end, text: `\n${packageLines.join("\n")}` });
    } else {
      const first = imports[0];
      const at = first.getStart(sf);
      edits.push({ start: at, end: at, text: `${packageLines.join("\n")}\n` });
    }
  }

  const next = applyEdits(text, edits);
  return next === text ? null : next;
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(abs, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(abs);
    }
  }
  return out;
}

const { resolved, blocked, pending } = resolveRules(loadMap());
const problems = [];
const changed = [];
for (const file of SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root)))) {
  const next = migrateFile(file, resolved, problems);
  if (next === null) continue;
  changed.push(repoRel(file));
  if (!DRY) fs.writeFileSync(file, next);
}

const active = [...resolved.values()].reduce((n, s) => n + s.active.size, 0);
console.log(
  `ui-migrate: ${active} names active, ${pending} pending (still exported where they were), ` +
    `${changed.length} files ${DRY ? "would change" : "rewritten"}.`,
);
if (DRY) for (const file of changed) console.log(`  ${file}`);
if (blocked.length > 0) {
  console.log(
    "\nRules that cannot apply yet (the name left its module, but not for a place that has it):",
  );
  for (const line of blocked) console.log(`  ${line}`);
}
if (problems.length > 0) {
  console.log("\nLeft for a hand edit:");
  for (const line of problems) console.log(`  ${line}`);
}
if (blocked.length > 0 || problems.length > 0 || (CHECK && changed.length > 0))
  process.exitCode = 1;

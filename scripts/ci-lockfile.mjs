// Which workspace packages a pnpm-lock.yaml change can reach: the CI planner's answer to "the
// lockfile changed", which used to be "validate the whole workspace" for every dependency edit.
//
// A package can only see what its own lockfile entry resolves (`importers.<dir>`) and what those
// resolutions depend on in turn (`snapshots`, with `packages` holding each version's tarball
// integrity). So a package is affected exactly when its own entry changed, or when an entry it
// reaches through that closure did. The walk stops at another workspace package (a `file:` or
// `link:` version): that package is its own importer, and pnpm's dependency graph already carries
// a change in it to everything that depends on it.
//
// Everything else in the file applies to every package at once — the lockfile version, settings,
// overrides, catalogs, patches — and so does the root importer (`.`): its devDependencies are the
// toolchain every package's scripts run (vitest, typescript, tsx, esbuild). A change to any of them,
// or a lockfile this reader does not recognise, validates the whole workspace, as before.
//
// The reader understands the subset of YAML pnpm writes for lockfile version 9: two-space
// indentation, single-quoted keys and values, one entry per key. It never needs a YAML library,
// because the planning job installs nothing.

/** Sections whose entries are compared one by one; every other top-level key is compared whole. */
const KEYED = new Set(["importers", "packages", "snapshots"]);
/** The dependency groups that put a package into an importer's or a snapshot's closure. */
const IMPORTER_GROUPS = new Set(["dependencies", "devDependencies", "optionalDependencies"]);
const SNAPSHOT_GROUPS = new Set(["dependencies", "optionalDependencies"]);

/** A YAML scalar as pnpm writes it: plain, or single-quoted with `''` for a quote. */
function scalar(text) {
  const value = text.trim();
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return JSON.parse(value);
  }
  return value;
}

/**
 * `key: value` or `key:` (after the indentation), split at the colon that ends the key: the
 * closing quote's for a quoted key, otherwise the first colon followed by a space or the end
 * (`file:packages/core` keeps its colon, as YAML reads it).
 */
function keyValue(text) {
  if (text.startsWith("'")) {
    let end = 1;
    while (end < text.length) {
      if (text[end] === "'" && text[end + 1] === "'") end += 2;
      else if (text[end] === "'") break;
      else end += 1;
    }
    if (text[end + 1] !== ":") return null;
    return { key: scalar(text.slice(0, end + 1)), value: text.slice(end + 2).trim() };
  }
  const match = /^(.*?):(?: (.*))?$/.exec(text);
  return match ? { key: match[1], value: (match[2] ?? "").trim() } : null;
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The lockfile as compared here: every top-level section's text, and each keyed section's
 * entries (their text, and the `[name, version]` pairs their dependency groups list). Returns
 * null for a file that does not read as a version 9 lockfile.
 */
function readLockfile(text) {
  const sections = new Map();
  const entries = new Map([...KEYED].map((name) => [name, new Map()]));
  let section = null;
  let entry = null;
  let group = null;
  let dependency = null;
  for (const raw of text.replaceAll("\r", "").split("\n")) {
    if (raw.trim() === "") continue;
    const indent = indentOf(raw);
    const line = raw.trimStart();
    if (indent === 0) {
      const top = keyValue(line);
      if (!top) return null;
      section = top.key;
      sections.set(section, [line]);
      entry = group = dependency = null;
      continue;
    }
    if (section === null) return null;
    sections.get(section).push(raw);
    if (!KEYED.has(section)) continue;
    if (indent === 2) {
      const head = keyValue(line);
      if (!head) return null;
      entry = { lines: [line], dependencies: [] };
      entries.get(section).set(head.key, entry);
      group = dependency = null;
      continue;
    }
    if (entry === null) return null;
    entry.lines.push(raw);
    const field = keyValue(line);
    if (indent === 4) {
      group = field?.key ?? null;
      dependency = null;
    } else if (indent === 6 && field) {
      if (section === "importers" && IMPORTER_GROUPS.has(group)) dependency = field.key;
      else if (section === "snapshots" && SNAPSHOT_GROUPS.has(group)) {
        entry.dependencies.push([field.key, scalar(field.value)]);
      }
    } else if (indent === 8 && section === "importers" && dependency && field?.key === "version") {
      entry.dependencies.push([dependency, scalar(field.value)]);
    }
  }
  if (!sections.has("lockfileVersion") || !sections.has("importers")) return null;
  const textOf = (lines) => lines.join("\n");
  return {
    sections: new Map([...sections].map(([name, lines]) => [name, textOf(lines)])),
    entries: new Map(
      [...entries].map(([name, map]) => [
        name,
        new Map([...map].map(([key, e]) => [key, { text: textOf(e.lines), deps: e.dependencies }])),
      ]),
    ),
  };
}

/**
 * The `snapshots` key a dependency resolves to, or null for another workspace package. An
 * aliased dependency (`npm:other@1.0.0`) names its target in the version itself.
 */
function snapshotKey(name, version) {
  if (/^(link|file):/.test(version)) return null;
  const bare = version.replace(/\(.*$/, "");
  return /^\d/.test(bare) || !bare.slice(1).includes("@") ? `${name}@${version}` : version;
}

/** `name@1.0.0(peer@2.0.0)` → `name@1.0.0`, the version's `packages` key. */
const packageKey = (key) => key.replace(/\(.*$/, "");

/** Entry keys whose text differs between the two readings, including added and removed ones. */
function changedKeys(before, after) {
  const changed = new Set();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key)?.text !== after.get(key)?.text) changed.add(key);
  }
  return changed;
}

/**
 * Compares two versions of pnpm-lock.yaml. Returns `{ whole }`, a reason, when the change reaches
 * every package (or the file cannot be read), and otherwise `{ importers }`: the importer
 * directories (`packages/core`) whose resolved dependencies changed.
 */
export function lockfileImporters(beforeText, afterText) {
  const before = beforeText === null ? null : readLockfile(beforeText);
  const after = afterText === null ? null : readLockfile(afterText);
  if (!before || !after) return { whole: "pnpm-lock.yaml could not be compared" };
  for (const name of new Set([...before.sections.keys(), ...after.sections.keys()])) {
    if (KEYED.has(name)) continue;
    if (before.sections.get(name) !== after.sections.get(name)) {
      return { whole: `pnpm-lock.yaml changed its ${name}` };
    }
  }
  const importersBefore = before.entries.get("importers");
  const importersAfter = after.entries.get("importers");
  const changedImporters = changedKeys(importersBefore, importersAfter);
  if (changedImporters.has(".")) {
    return { whole: "pnpm-lock.yaml changed the root's dependencies, every package's toolchain" };
  }
  const changedSnapshots = changedKeys(
    before.entries.get("snapshots"),
    after.entries.get("snapshots"),
  );
  const changedPackages = changedKeys(
    before.entries.get("packages"),
    after.entries.get("packages"),
  );
  const snapshots = after.entries.get("snapshots");
  /** Whether an importer's resolved closure reaches a changed snapshot or package version. */
  const reachesChange = (importer) => {
    const seen = new Set();
    const queue = importer.deps.map(([name, version]) => snapshotKey(name, version));
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      if (changedSnapshots.has(key) || changedPackages.has(packageKey(key))) return true;
      for (const [name, version] of snapshots.get(key)?.deps ?? []) {
        queue.push(snapshotKey(name, version));
      }
    }
    return false;
  };
  const importers = new Set(changedImporters);
  for (const [dir, importer] of importersAfter) {
    if (dir !== "." && !importers.has(dir) && reachesChange(importer)) importers.add(dir);
  }
  if (reachesChange(importersAfter.get(".") ?? { deps: [] })) {
    return { whole: "pnpm-lock.yaml changed a package the root's toolchain resolves" };
  }
  return { importers: [...importers].sort() };
}

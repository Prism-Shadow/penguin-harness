#!/usr/bin/env node
// Reads and ports another coding tool's files for the agent-porting skill so that no secret value
// enters the conversation (and so never the Session's Trace, which an export may carry).
//
//   node inspect-config.mjs <config>... [--only <key>[,<key>...]] [--keys]
//   node inspect-config.mjs --emit <source> --framework <name> --out <port folder>
//                           [--project <path>] [--profile <name>] [--confirmed]
//   node inspect-config.mjs --append <text file> --to <file> [--heading <text>] [--confirmed]
//   node inspect-config.mjs --scan <dir-or-file>...
//   node inspect-config.mjs --show <file>... [--lines <from>-<to>] [--key <dotted.path>]
//
// Porting writes, it does not read: `--emit` parses a source configuration (or a subagent file)
// and writes what maps into the port folder itself — `manifest.json`'s `definition.mcpServers`
// with commands, arguments, addresses and plain values exactly as the source has them and every
// credential replaced by a `${NAME}` Vault reference (listed in `vaultKeys`), hook packages for
// the hooks that map, the thinking level, a subagent's instructions — and prints a summary in the
// masked view's terms. `--append` copies a text file (instructions, a rule) into another the same
// way. The real values go file to file.
//
// The masked view (the default mode) is for understanding a configuration's structure. It prints
// by allowlist: key names, numbers and booleans; a string only when it is a reference to a plain
// variable name, the value of a structural key, a flag or a path- or package-shaped argument, a
// URL's scheme, host and plain first path segment, or a variable's name where a key holds one; a
// shell line as its program and a word count. Everything else is `<redacted:N chars>`. Prose keys
// print as a pointer to `--show --key`. A file that does not parse names its line and prints its
// key names only. See lib/mask.mjs.
//
// Text has no structure to allowlist, so `--show` and `--scan` are best effort (lib/detect.mjs,
// `lineKind`): `--show` replaces each flagged line whole, `--scan` names `file:line: <kind>` and
// never the line, and exits 1 when it flags anything. A Markdown frontmatter goes through the
// masked view in `--show` and is checked by position in `--scan`. Credential stores are refused
// unread by every mode. Built-in modules only.
import fs from "node:fs";
import path from "node:path";
import { append, emit } from "./lib/emit.mjs";
import { PEM_END, frontmatterHits, isCode, isRefused, lineKind, maskLines } from "./lib/detect.mjs";
import { at, mask } from "./lib/mask.mjs";
import { formatOf, keysOnly, parseConfig, parseYaml, splitFrontmatter } from "./lib/parse.mjs";

const USAGE = [
  "usage: node inspect-config.mjs <config>... [--only <key>[,<key>...]] [--keys]",
  "       node inspect-config.mjs --emit <source> --framework <name> --out <port folder> [--project <path>] [--profile <name>] [--confirmed]",
  "       node inspect-config.mjs --append <text file> --to <file> [--heading <text>] [--confirmed]",
  "       node inspect-config.mjs --scan <dir-or-file>...",
  "       node inspect-config.mjs --show <file>... [--lines <from>-<to>] [--key <dotted.path>]",
].join("\n");
const usage = () => {
  console.error(USAGE);
  process.exit(2);
};

/** `--name value` options out of `args`, the rest left as positionals. */
function options(args, names, flags = []) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, "");
    if (args[i].startsWith("--") && names.includes(name)) {
      if (args[i + 1] === undefined) usage();
      opts[name] = args[++i];
    } else if (args[i].startsWith("--") && flags.includes(name)) opts[name] = true;
    else rest.push(args[i]);
  }
  return { opts, rest };
}

// ---- --scan ----------------------------------------------------------------------------------

/** Folders a tool fills with transcripts, history and caches: never part of a port. */
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "file-history",
  "shell-snapshots",
  "paste-cache",
  "image-cache",
  "debug",
  "cache",
  "sessions",
  "statsig",
  "todos",
]);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** The lines of one text file a detector flags, as `[line, kind]`; null for a binary file. */
function flaggedLines(file) {
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) return null;
  const text = buf.toString("utf8");
  const hits = [];
  let inKey = false;
  text.split(/\r?\n/).forEach((line, n) => {
    if (inKey) {
      if (PEM_END.test(line)) inKey = false;
      return;
    }
    const kind = lineKind(line, isCode(file));
    if (kind === null) return;
    if (kind === "private key block" && !PEM_END.test(line)) inKey = true;
    hits.push([n + 1, kind]);
  });
  if (formatOf(file) === "markdown") {
    const fm = splitFrontmatter(text);
    if (fm !== null) {
      for (const [line, kind] of frontmatterHits(fm.block)) {
        if (!hits.some(([l]) => l === line + 1)) hits.push([line + 1, kind]);
      }
      hits.sort((a, b) => a[0] - b[0]);
    }
  }
  return hits;
}

function scan(targets) {
  let found = 0;
  const visit = (target, root) => {
    const rel = path.relative(root, target) || path.basename(target);
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (err) {
      console.log(`${rel}: ${err.code ?? "unreadable"}`);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) {
        if (!SKIPPED_DIRS.has(entry)) visit(path.join(target, entry), root);
      }
      return;
    }
    if (!stat.isFile() || /\.jsonl$/i.test(target)) return;
    if (isRefused(target)) {
      found++;
      console.log(`${rel}: credential file (not read)`);
      return;
    }
    if (stat.size > MAX_SCAN_BYTES) {
      console.log(`${rel}: larger than 2 MiB (not scanned; not part of a port)`);
      return;
    }
    for (const [line, kind] of flaggedLines(target) ?? []) {
      found++;
      console.log(`${rel}:${line}: ${kind}`);
    }
  };
  for (const target of targets) {
    const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
    visit(target, stat?.isDirectory() ? target : path.dirname(target));
  }
  console.log(
    found === 0
      ? "# no credential-looking value (best effort)"
      : `# ${found} finding(s) (best effort): a file flagged here is ported only after the user confirms`,
  );
  return found === 0 ? 0 : 1;
}

// ---- --show ----------------------------------------------------------------------------------

/** A text file's lines for --show: a Markdown frontmatter masked by allowlist, the rest by line. */
function shownText(file, text) {
  if (formatOf(file) !== "markdown") return maskLines(text, isCode(file)).split("\n");
  const fm = splitFrontmatter(text);
  if (fm === null) return maskLines(text, false).split("\n");
  let head;
  try {
    head = JSON.stringify(mask(parseYaml(fm.block) ?? {}), null, 2);
  } catch (err) {
    head = `# could not parse the frontmatter${err?.line ? ` (line ${err.line + 1})` : ""}; key names only\n${keysOnly(fm.block)}`;
  }
  return [
    "--- (frontmatter, masked)",
    ...head.split("\n"),
    "---",
    ...maskLines(fm.body, false).split("\n"),
  ];
}

function show(files, range, key) {
  let status = 0;
  for (const file of files) {
    if (isRefused(file)) {
      console.log(`# ${file}: a credential store; not read`);
      status = 3;
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (err) {
      console.log(`# ${file}: ${err.code ?? "unreadable"}`);
      status = 1;
      continue;
    }
    if (buf.includes(0)) {
      console.log(`# ${file}: not a text file`);
      continue;
    }
    let lines;
    let what = "flagged lines masked, best effort";
    if (key !== null) {
      const format = formatOf(file);
      let value;
      try {
        const text = buf.toString("utf8");
        const fm = format === "markdown" ? splitFrontmatter(text) : null;
        value = at(
          format === "markdown" ? parseYaml(fm?.block ?? "") : parseConfig(text, format),
          key,
        );
      } catch (err) {
        console.log(`# could not parse ${file}${err?.line ? ` (line ${err.line})` : ""}`);
        status = 1;
        continue;
      }
      if (typeof value !== "string") {
        console.log(`# ${file}: no text at ${key}`);
        status = 1;
        continue;
      }
      lines = maskLines(value, false).split("\n");
      what = `${key}, flagged lines masked, best effort`;
    } else {
      lines = shownText(file, buf.toString("utf8"));
    }
    const total = lines.length;
    if (range !== null) lines = lines.slice(range[0] - 1, range[1]);
    const span =
      range === null ? "" : `, lines ${range[0]}-${Math.min(range[1], total)} of ${total}`;
    console.log(`# ${file} (${what}${span})\n${lines.join("\n")}`);
  }
  return status;
}

// ---- The masked view -------------------------------------------------------------------------

/** `~/.claude.json`: its MCP servers, and nothing else of the account state it holds. */
function claudeJsonView(c) {
  const projects = {};
  for (const [dir, p] of Object.entries(c.projects ?? {})) {
    if (p && typeof p === "object" && p.mcpServers && Object.keys(p.mcpServers).length > 0) {
      projects[dir] = { mcpServers: p.mcpServers };
    }
  }
  return { mcpServers: c.mcpServers ?? {}, projects };
}

function view(files, only, keys) {
  let status = 0;
  for (const file of files) {
    if (isRefused(file)) {
      console.log(`# ${file}: a credential store; not read`);
      status = 3;
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.log(`# ${file}: ${err.code ?? "unreadable"}`);
      status = 1;
      continue;
    }
    const format = formatOf(file);
    if (format === null || format === "markdown") {
      console.log(`# ${file}: not a JSON, TOML or YAML file; read text with --show`);
      status = 1;
      continue;
    }
    if (keys) {
      console.log(`# ${file} (${format}, key names only)\n${keysOnly(text)}`);
      continue;
    }
    let data;
    try {
      data = parseConfig(text, format);
    } catch (err) {
      const line = err?.line ?? null;
      console.log(
        `# could not parse ${file}${line ? ` (line ${line})` : ""}; key names only\n${keysOnly(text)}`,
      );
      status = 1;
      continue;
    }
    if (path.basename(file) === ".claude.json") data = claudeJsonView(data ?? {});
    if (only !== null)
      data = Object.fromEntries(
        only.map((p) => [p, at(data ?? {}, p)]).filter(([, v]) => v !== undefined),
      );
    console.log(`# ${file} (${format})\n${JSON.stringify(mask(data), null, 2)}`);
  }
  return status;
}

// ---- Main ------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const mode = args[0];
if (mode === "--scan") {
  if (args.length < 2) usage();
  process.exit(scan(args.slice(1)));
}
if (mode === "--show") {
  const { opts, rest } = options(args.slice(1), ["lines", "key"]);
  let range = null;
  if (opts.lines !== undefined) {
    const m = /^(\d+)-(\d+)$/.exec(opts.lines);
    if (m === null) usage();
    range = [Number(m[1]), Number(m[2])];
  }
  if (rest.length === 0) usage();
  process.exit(show(rest, range, opts.key ?? null));
}
if (mode === "--emit") {
  const { opts, rest } = options(
    args.slice(1),
    ["framework", "out", "project", "profile"],
    ["confirmed"],
  );
  if (rest.length !== 1 || opts.framework === undefined || opts.out === undefined) usage();
  process.exit(
    emit(rest[0], {
      framework: opts.framework,
      out: opts.out,
      project: opts.project ?? null,
      profile: opts.profile ?? null,
      confirmed: opts.confirmed === true,
    }),
  );
}
if (mode === "--append") {
  const { opts, rest } = options(args.slice(1), ["to", "heading"], ["confirmed"]);
  if (rest.length !== 1 || opts.to === undefined) usage();
  process.exit(
    append(rest[0], opts.to, { heading: opts.heading ?? null, confirmed: opts.confirmed === true }),
  );
}
const { opts, rest } = options(args, ["only"], ["keys"]);
if (rest.length === 0) usage();
process.exit(
  view(rest, opts.only ? opts.only.split(",").filter(Boolean) : null, opts.keys === true),
);

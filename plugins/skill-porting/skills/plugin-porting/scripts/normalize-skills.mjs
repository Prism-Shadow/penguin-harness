#!/usr/bin/env node
// Normalises every skill of a package being ported into a PenguinHarness plugin package.
//
//   node normalize-skills.mjs <package dir> [--version YYYY.MM.DD.N]
//
// For each directory under <package dir>/skills/:
// - the directory name keeps only letters, digits, "_" and "-" (anything else becomes "-");
// - SKILL.md's frontmatter is rewritten to exactly three single-line keys: `name` (the
//   directory), `description` (one line; a block scalar is flattened, a `when_to_use` is merged
//   in) and `version` (a dated version the skill already carries, else the given one, else
//   today's UTC date with sequence number 1); every other key is dropped, and named;
// - another tool's display metadata (`agents/*.yaml`) is removed, and so is every file that is
//   not UTF-8 text (images, archives), every symlink and every .DS_Store;
// - a directory without a SKILL.md is not a skill and is removed.
// It prints what it changed, one line per skill. Built-in modules only.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const pkg = args[0];
const versionAt = args.indexOf("--version");
const DATED = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const today = `${new Date().toISOString().slice(0, 10).replace(/-/g, ".")}.1`;
const fallbackVersion = versionAt !== -1 ? args[versionAt + 1] : today;
if (pkg === undefined || !DATED.test(fallbackVersion ?? "")) {
  console.error("usage: node normalize-skills.mjs <package dir> [--version YYYY.MM.DD.N]");
  process.exit(2);
}
const skillsDir = path.join(pkg, "skills");
if (!fs.existsSync(skillsDir)) {
  console.error(`${skillsDir} does not exist: copy the upstream skills there first`);
  process.exit(1);
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const isText = (file) => {
  try {
    strictUtf8.decode(fs.readFileSync(file));
    return true;
  } catch {
    return false;
  }
};

/** A quoted YAML scalar without its quotes; a plain one as it is. */
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * The frontmatter's top-level keys: a scalar's text on one line (plain, quoted, continued on
 * indented lines, or a `|` / `>` block), null for a list or a nested map. Null when there is no
 * frontmatter.
 */
function readFrontmatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (match === null) return null;
  const lines = match[1].split(/\r?\n/);
  const fields = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const key = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(lines[i]);
    if (key === null) continue;
    const head = (key[2] ?? "").trim();
    const rest = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
      rest.push(lines[(i += 1)].trim());
    }
    const more = rest.filter((line) => line !== "");
    const structured = more.some((line) => /^- |^-$|^[A-Za-z0-9_-]+:(\s|$)/.test(line));
    let value;
    if (/^[|>][+-]?\d*$/.test(head)) value = more.join(" ");
    else if (head === "" && structured) value = null;
    else value = unquote([head, ...more].filter((part) => part !== "").join(" "));
    fields.set(key[1], value === null ? null : value.replace(/\s+/g, " ").trim());
  }
  return { fields, body: text.slice(match[0].length) };
}

/** The first paragraph line of a body without frontmatter: what such a skill says it does. */
const firstLine = (body) =>
  body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#") && !line.startsWith("```")) ?? "";

let count = 0;
for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let dir = path.join(skillsDir, entry.name);
  const skillFile = () => path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile())) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`skills/${entry.name}: no SKILL.md, so not a skill: removed`);
    continue;
  }
  const notes = [];
  const name = entry.name.replace(/[^A-Za-z0-9_-]+/g, "-");
  if (name !== entry.name) {
    const renamed = path.join(skillsDir, name);
    fs.renameSync(dir, renamed);
    dir = renamed;
    notes.push(`renamed from ${entry.name}`);
  }

  const text = fs.readFileSync(skillFile(), "utf8");
  const front = readFrontmatter(text);
  let description;
  let version = fallbackVersion;
  let body;
  if (front === null) {
    body = text;
    description = firstLine(text);
    notes.push("had no frontmatter: description taken from its first line");
  } else {
    body = front.body;
    const { fields } = front;
    description = fields.get("description") ?? "";
    const when = fields.get("when_to_use");
    if (typeof when === "string" && when !== "") description = `${description} Use when: ${when}`.trim();
    if (DATED.test(fields.get("version") ?? "")) version = fields.get("version");
    const dropped = [...fields.keys()].filter(
      (key) => !["name", "description", "version", "when_to_use"].includes(key),
    );
    if (dropped.length > 0) notes.push(`dropped frontmatter keys: ${dropped.join(", ")}`);
    if (fields.get("description") === null) notes.push("description was not text: emptied");
  }
  if (description === "") notes.push("no description: write one");
  fs.writeFileSync(
    skillFile(),
    `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`,
  );

  const removed = [];
  const agents = path.join(dir, "agents");
  if (fs.existsSync(agents) && fs.statSync(agents).isDirectory()) {
    for (const file of fs.readdirSync(agents)) {
      if (/\.ya?ml$/i.test(file)) {
        fs.rmSync(path.join(agents, file), { force: true });
        removed.push(`agents/${file}`);
      }
    }
    if (fs.readdirSync(agents).length === 0) fs.rmdirSync(agents);
  }
  const walk = (abs, rel) => {
    for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, child.name);
      const childRel = rel === "" ? child.name : `${rel}/${child.name}`;
      if (child.isSymbolicLink() || child.name === ".DS_Store" || child.name === "Thumbs.db") {
        fs.rmSync(childAbs, { force: true });
        removed.push(childRel);
      } else if (child.isDirectory()) {
        walk(childAbs, childRel);
        if (fs.readdirSync(childAbs).length === 0) fs.rmdirSync(childAbs);
      } else if (child.isFile() && !isText(childAbs)) {
        fs.rmSync(childAbs, { force: true });
        removed.push(childRel);
      }
    }
  };
  walk(dir, "");
  if (removed.length > 0) notes.push(`removed: ${removed.join(", ")}`);
  count += 1;
  console.log(`skills/${name}: version ${version}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`);
}
console.log(`${count} skills normalised in ${skillsDir}`);

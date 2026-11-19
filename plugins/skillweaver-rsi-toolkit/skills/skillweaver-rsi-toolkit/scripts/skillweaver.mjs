#!/usr/bin/env node
// The controller's tool for a SkillWeaver skill library, shipped by skillweaver-rsi-toolkit.
// Only the controller runs it; the Target only reads INDEX.md and calls the API scripts.
//
//   node skillweaver.mjs init <apis-dir> <site-url>     create library.json and copy the runtime
//   node skillweaver.mjs role-reply <trace>...         validate the final assistant text as one JSON object
//   node skillweaver.mjs check <api-file>               code verification; prints {"name","problems":[…]}
//   node skillweaver.mjs register <apis-dir> <name> <ref>   a new API, or a new version of one
//   node skillweaver.mjs tested <apis-dir> <name> <ref>     one more passing test
//   node skillweaver.mjs pick-test <apis-dir> [--seed N]   choose an untested API (practice utility)
//   node skillweaver.mjs index <apis-dir>               rewrite INDEX.md from the APIs and library.json
//   node skillweaver.mjs fingerprint <dir>              one SHA-256 over every file under <dir>, and each file's
//   node skillweaver.mjs verify-runtime <apis-dir>      the runtime copy is byte-identical to the shipped one
//
// Every command prints one JSON object and exits 1 on a refusal.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PARAM_TYPES, samePath } from "./skillweaver-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME = "skillweaver-api.mjs";
const NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;
const FORBIDDEN_PREFIXES = ["test_", "verify_", "explore_", "check_"];
const ALLOWED_IMPORT = "./skillweaver-api.mjs";

function readLibrary(dir) {
  return JSON.parse(readFileSync(path.join(dir, "library.json"), "utf8"));
}

function writeLibrary(dir, lib) {
  writeFileSync(path.join(dir, "library.json"), `${JSON.stringify(lib, null, 2)}\n`);
}

export function apiFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && f !== RUNTIME)
    .sort();
}

/** Interaction calls in an API's source: upstream's count_interactions, over `browser.*`. */
export function countInteractions(source) {
  return (source.match(/\bbrowser\.(open|click|type|exec|waitFor)\s*\(/g) ?? []).length;
}

/** The static half of code verification: what can be checked without importing the module. */
export function checkSource(source, fileName) {
  const problems = [];
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
    (m) => m[1],
  );
  const bare = [...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const spec of [...imports, ...bare]) {
    if (spec !== ALLOWED_IMPORT)
      problems.push(`imports "${spec}": only ${ALLOWED_IMPORT} is allowed`);
  }
  if (/\bimport\s*\(/.test(source)) problems.push("uses a dynamic import()");
  if (/\brequire\s*\(/.test(source)) problems.push("uses require()");
  if (/\bprocess\.(exit|env)\b/.test(source)) problems.push("touches process.exit or process.env");
  if (!/^runApi\(import\.meta\.url,\s*meta,\s*run\);\s*$/m.test(source)) {
    problems.push("does not end with `runApi(import.meta.url, meta, run);`");
  }
  const runAt = source.search(/export\s+async\s+function\s+run\s*\(/);
  if (runAt === -1) {
    problems.push("has no `export async function run(args)`");
  } else {
    const body = source.slice(runAt);
    const first = body.match(/\bbrowser\.(\w+)\s*\(\s*(["'`])?(.)?/);
    if (first === null || first[1] !== "open" || first[2] === undefined || first[3] !== "/") {
      problems.push('its first browser call is not browser.open("/…") with a site-relative path');
    }
  }
  if (countInteractions(source) < 2) {
    problems.push("makes fewer than two browser calls: a single click or read is not a skill");
  }
  if (fileName !== undefined && !fileName.endsWith(".mjs"))
    problems.push("file name must end in .mjs");
  return problems;
}

/** The dynamic half: the exported meta and run, once the source passed the static checks. */
export function checkMeta(meta, run, fileName) {
  const problems = [];
  if (meta === null || typeof meta !== "object") return ["exports no `meta` object"];
  const { name, description, params, returns, usage_log: usageLog } = meta;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    problems.push("meta.name must be snake_case, 3-64 characters");
  } else {
    if (FORBIDDEN_PREFIXES.some((p) => name.startsWith(p))) {
      problems.push(`meta.name may not start with ${FORBIDDEN_PREFIXES.join(", ")}`);
    }
    if (fileName !== undefined && `${name}.mjs` !== path.basename(fileName)) {
      problems.push(`meta.name "${name}" does not match the file name ${path.basename(fileName)}`);
    }
  }
  if (typeof description !== "string" || description.trim().length < 20) {
    problems.push("meta.description must document the behaviour (20+ characters)");
  }
  if (typeof returns !== "string" || returns.trim() === "") {
    problems.push("meta.returns must say what the result holds");
  }
  if (
    !Array.isArray(usageLog) ||
    usageLog.length === 0 ||
    !usageLog.every((e) => typeof e === "string")
  ) {
    problems.push("meta.usage_log must list at least one observed use, as strings");
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    problems.push("meta.params must be an object (possibly empty)");
  } else {
    for (const [p, spec] of Object.entries(params)) {
      if (!NAME_RE.test(p) && !/^[a-z]{1,2}$/.test(p))
        problems.push(`param "${p}" must be snake_case`);
      if (/_(id|url)$/.test(p) || p === "id" || p === "url") {
        problems.push(`param "${p}" is an id or URL: use a human-readable value instead`);
      }
      if (spec === null || typeof spec !== "object") {
        problems.push(`param "${p}" needs {type, description}`);
        continue;
      }
      if (!PARAM_TYPES.includes(spec.type)) {
        problems.push(
          `param "${p}" has type ${JSON.stringify(spec.type)}; use ${PARAM_TYPES.join(", ")}`,
        );
      }
      if (typeof spec.description !== "string" || spec.description.trim() === "") {
        problems.push(`param "${p}" needs a description`);
      }
    }
  }
  if (typeof run !== "function" || run.constructor?.name !== "AsyncFunction") {
    problems.push("run must be an exported async function");
  }
  return problems;
}

export async function checkApi(file) {
  const abs = path.resolve(file);
  const source = readFileSync(abs, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" });
  if (syntax.status !== 0) {
    return {
      name: null,
      problems: [`syntax error: ${(syntax.stderr || "").trim().split("\n").slice(0, 4).join(" ")}`],
    };
  }
  const problems = checkSource(source, abs);
  if (problems.length > 0) return { name: null, problems };
  // The static checks allow only the runtime import, and runApi does nothing when imported.
  const mod = await import(`${pathToFileURL(abs).href}?check=${Date.now()}`);
  const metaProblems = checkMeta(mod.meta, mod.run, abs);
  return { name: mod.meta?.name ?? null, problems: metaProblems };
}

export function init(dir, site) {
  if (!/^https?:\/\/[^/\s]+/.test(site ?? "")) throw new Error("site must be an http(s) URL");
  if (existsSync(path.join(dir, "library.json")))
    throw new Error("library.json exists already: never reinitialise a library");
  copyFileSync(path.join(HERE, RUNTIME), path.join(dir, RUNTIME));
  writeLibrary(dir, { site, apis: {} });
  return { site, apis: 0 };
}

export function register(dir, name, ref) {
  const lib = readLibrary(dir);
  if (!existsSync(path.join(dir, `${name}.mjs`))) throw new Error(`no ${name}.mjs in the library`);
  const prev = lib.apis[name];
  lib.apis[name] = prev
    ? { ...prev, version: prev.version + 1, updated: ref, tests: [] }
    : { version: 1, created: ref, updated: ref, tests: [] };
  writeLibrary(dir, lib);
  return { name, ...lib.apis[name] };
}

export function tested(dir, name, ref) {
  const lib = readLibrary(dir);
  if (!lib.apis[name]) throw new Error(`${name} is not registered`);
  lib.apis[name].tests.push(ref);
  writeLibrary(dir, lib);
  return { name, tests: lib.apis[name].tests.length };
}

/** Deterministic PRNG for reproducible choices (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Upstream's test choice: softmax over (interaction count − version) among untested APIs. */
export function pickTest(dir, seed = Date.now()) {
  const lib = readLibrary(dir);
  const untested = Object.entries(lib.apis)
    .filter(([, a]) => a.tests.length === 0)
    .map(([name, a]) => {
      const source = readFileSync(path.join(dir, `${name}.mjs`), "utf8");
      return { name, utility: countInteractions(source) - a.version };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
  if (untested.length === 0) return { name: null, utilities: {} };
  const max = Math.max(...untested.map((u) => u.utility));
  const weights = untested.map((u) => Math.exp(u.utility - max));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng(seed)() * total;
  let chosen = untested[untested.length - 1].name;
  for (let i = 0; i < untested.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosen = untested[i].name;
      break;
    }
  }
  return { name: chosen, utilities: Object.fromEntries(untested.map((u) => [u.name, u.utility])) };
}

function signature(meta) {
  const params = Object.entries(meta.params ?? {}).map(
    ([p, s]) => `${p}${s.optional === true ? "?" : ""}: ${s.type}`,
  );
  return `${meta.name}(${params.join(", ")})`;
}

export async function buildIndex(dir) {
  const lib = readLibrary(dir);
  const entries = [];
  for (const file of apiFiles(dir)) {
    const name = file.replace(/\.mjs$/, "");
    if (!lib.apis[name]) continue; // only registered (verified) APIs are offered
    const mod = await import(`${pathToFileURL(path.join(dir, file)).href}?index=${Date.now()}`);
    entries.push({ meta: mod.meta, rec: lib.apis[name] });
  }
  const lines = [
    `# Skill library for ${lib.site}`,
    "",
    "Each API below is a script beside this file. Call it from the shell as",
    "`node <this directory>/<name>.mjs --args '<JSON object of its parameters>'`; it drives the agent",
    'browser and prints one JSON line, `{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`.',
    "Where the shell mangles quotes (Windows PowerShell), write the JSON to a file and pass",
    "`--args-file <file>` instead.",
    "",
  ];
  if (entries.length === 0) lines.push("No API has been learned yet.", "");
  for (const { meta, rec } of entries) {
    lines.push(`## ${signature(meta)}`, "", meta.description.trim(), "");
    for (const [p, s] of Object.entries(meta.params ?? {}))
      lines.push(
        `- \`${p}\` (${s.type}${s.optional === true ? ", optional" : ""}): ${s.description}`,
      );
    if (Object.keys(meta.params ?? {}).length > 0) lines.push("");
    lines.push(`Returns: ${meta.returns.trim()}`, "");
    lines.push(
      `Version ${rec.version}; ${rec.tests.length === 0 ? "untested" : `tested ${rec.tests.length} time(s)`}.`,
      "",
    );
    lines.push("Usage log:", ...meta.usage_log.map((u) => `- ${u}`), "");
  }
  writeFileSync(path.join(dir, "INDEX.md"), `${lines.join("\n").trimEnd()}\n`);
  return { apis: entries.length };
}

/** Every regular file under `dir`, as sorted POSIX-style relative paths. */
function filesUnder(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(dir, child));
    else if (entry.isFile()) out.push(child);
  }
  return out.sort();
}

/**
 * A fingerprint of a directory: the SHA-256 of each file and one digest over all of them, so the
 * controller can prove that nobody but its Publish step changed the library between two points.
 */
export function fingerprint(dir) {
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  const files = {};
  const all = createHash("sha256");
  for (const rel of filesUnder(dir)) {
    const digest = createHash("sha256")
      .update(readFileSync(path.join(dir, rel)))
      .digest("hex");
    files[rel] = digest;
    all.update(`${rel}\0${digest}\n`);
  }
  return { digest: all.digest("hex"), files };
}

/** The runtime an API library carries must be the one this toolkit ships, byte for byte. */
export function verifyRuntime(dir) {
  const shipped = readFileSync(path.join(HERE, RUNTIME));
  const copy = path.join(dir, RUNTIME);
  const problems = [];
  if (!existsSync(copy)) problems.push(`${RUNTIME} is missing from the library`);
  else if (!readFileSync(copy).equals(shipped))
    problems.push(`${RUNTIME} differs from the shipped runtime`);
  return { problems };
}

/** Read the final assistant text, excluding earlier turns, tool progress and reasoning. */
export function readRoleReply(traceFiles) {
  if (traceFiles.length === 0) {
    throw new Error("role-reply requires the role's Trace files in order");
  }
  let text = null;
  for (const file of traceFiles) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record?.type !== "model_msg") continue;
      const message = record.payload;
      if (message?.type === "tool_call" || (message?.role === "user" && message.type === "text")) {
        text = null;
      } else if (message?.role === "assistant" && message.type === "text") {
        text = message.text;
      }
    }
  }
  if (typeof text !== "string") {
    return { problems: ["The role Trace has no final assistant text"] };
  }
  try {
    const reply = JSON.parse(text);
    if (reply !== null && typeof reply === "object" && !Array.isArray(reply)) {
      return { text, reply, problems: [] };
    }
  } catch {
    // Keep the full text for the correction request without extracting a JSON fragment.
  }
  return { text, problems: ["The final assistant text must be exactly one JSON object"] };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "init":
      return init(rest[0], rest[1]);
    case "role-reply":
      return readRoleReply(rest);
    case "check":
      return checkApi(rest[0]);
    case "register":
      return register(rest[0], rest[1], rest[2]);
    case "tested":
      return tested(rest[0], rest[1], rest[2]);
    case "pick-test": {
      const i = rest.indexOf("--seed");
      return pickTest(rest[0], i === -1 ? undefined : Number(rest[i + 1]));
    }
    case "index":
      return buildIndex(rest[0]);
    case "fingerprint":
      return fingerprint(rest[0]);
    case "verify-runtime":
      return verifyRuntime(rest[0]);
    default:
      throw new Error(`unknown command ${JSON.stringify(cmd)}`);
  }
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (res) => {
      process.stdout.write(`${JSON.stringify(res)}\n`);
      if (res && Array.isArray(res.problems) && res.problems.length > 0) process.exitCode = 1;
    },
    (err) => {
      process.stdout.write(`${JSON.stringify({ error: String(err?.message ?? err) })}\n`);
      process.exitCode = 1;
    },
  );
}

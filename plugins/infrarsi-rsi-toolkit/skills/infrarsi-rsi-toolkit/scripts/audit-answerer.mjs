#!/usr/bin/env node
// Audit one InfraRSI answerer session before its answer is handed in.
//
//   node audit-answerer.mjs --traces <answerer traces dir> <request dir> [answer file name]
//   node audit-answerer.mjs <answerer Trace .jsonl> <request dir> [answer file name]
//
// With --traces it finds the session itself: the newest session in that directory (its dated
// subdirectories included) whose first prompt names the request directory, all its Trace parts
// joined in order. The result then also carries `session` and `trace_files`.
//
// It reads the Trace the harness wrote for the answerer's session and checks what the session
// actually did, not what it was told: the tools it was given, and every tool call it made.
//   - tools: only read_file, write_file and exec_command were offered;
//   - read_file: every path is inside the request directory (or is the toolkit's viewer script);
//   - write_file: the only path written is the answer file in that directory;
//   - exec_command: every command only prints request files: print-only filters and the
//     toolkit's own print-request.mjs viewer, piped and chained with && or ;, after a cd that stays
//     inside; no other program, heredoc, command substitution or redirection into a file.
// It prints one JSON object: {ok, tools, calls, tokens, violations, scripts_sha256}; exit code 1
// when not ok. scripts_sha256 holds the SHA-256 of this script and of print-request.mjs as they
// are on disk, so a run can show that the audit and the viewer stayed the toolkit's own.
// `tokens` is the session's total from its last token_usage event (for `--tokens`), or null.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_TOOLS = ["read_file", "write_file", "exec_command"];
// Filters that only print their input (`echo` its arguments, `grep` the matching lines); `sed` only
// as `sed -n <range>p`. awk is not one: its programs can write files and run commands.
const PRINTERS = new Set([
  "cat",
  "fold",
  "head",
  "tail",
  "cut",
  "wc",
  "ls",
  "sed",
  "jq",
  "echo",
  "grep",
  "nl",
  "sort",
  "uniq",
]);

// The toolkit's own read-only request viewer, the one program besides the filters an answerer may run.
const VIEWER = /(^|\/)infrarsi-rsi-toolkit\/scripts\/print-request\.mjs$/;

/** Problems with `node <toolkit>/scripts/print-request.mjs <request dir> [file] [--start N] [--lines M]`. */
function checkViewer(args, dir, cwd) {
  const [script, ...rest] = args;
  if (!VIEWER.test(script ?? ""))
    return [`runs node ${script ?? ""}, which is not the toolkit's print-request.mjs`];
  const problems = [];
  const plain = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--start" || rest[i] === "--lines") {
      if (!/^\d+$/.test(rest[i + 1] ?? ""))
        problems.push(`print-request.mjs ${rest[i]} needs a number`);
      i += 1;
    } else if (rest[i].startsWith("-")) {
      problems.push(`print-request.mjs takes no option ${rest[i]}`);
    } else plain.push(rest[i]);
  }
  if (plain.length === 0 || plain.length > 2)
    return [...problems, "print-request.mjs takes the request directory and at most one file name"];
  const target = path.resolve(cwd, plain[0]);
  if (!inside(dir, target))
    problems.push(`print-request.mjs outside the request directory: ${plain[0]}`);
  if (plain[1] !== undefined && !inside(dir, path.resolve(target, plain[1]))) {
    problems.push(`print-request.mjs reads outside the request directory: ${plain[1]}`);
  }
  return problems;
}

function inside(dir, p) {
  const rel = path.relative(dir, path.resolve(dir, p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Split a command line into words, honouring simple single and double quotes. */
export function words(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Problems with one exec_command line, or [] when it only prints request files: print-only
 * pipelines, chained with `&&` or `;`, optionally after `cd <request dir>`, with stderr
 * discarded at most. Anything else (another program, a heredoc, command substitution, a
 * redirection into a file, a test, `||`) is a problem.
 */
export function checkCommand(cmd, dir) {
  const text = cmd.trim().replace(/\s2>\s*\/dev\/null/g, " ");
  if (text === "") return ["empty command"];
  if (/`|\$\(|<<|>|<|\|\||\n/.test(text)) {
    return [
      `not a plain print command (substitution, heredoc, redirection or several lines): ${cmd.slice(0, 160)}`,
    ];
  }
  const problems = [];
  let cwd = dir;
  for (const part of text.split(/\s*(?:&&|;)\s*/)) {
    const [first, ...firstArgs] = words(part);
    if (first === undefined) {
      problems.push("empty command in a chain");
      continue;
    }
    if (first === "cd") {
      const target = firstArgs[0] ?? "";
      if (firstArgs.length !== 1 || !inside(dir, path.resolve(cwd, target))) {
        problems.push(`cd outside the request directory: ${target}`);
        return problems;
      }
      cwd = path.resolve(cwd, target);
      continue;
    }
    for (const segment of part.split("|")) {
      const [prog, ...args] = words(segment);
      if (prog === undefined) {
        problems.push("empty pipeline segment");
        continue;
      }
      if (prog === "node") {
        problems.push(...checkViewer(args, dir, cwd));
        continue;
      }
      if (!PRINTERS.has(prog)) {
        problems.push(`runs ${prog}, which is not a print-only filter`);
        continue;
      }
      // sort and uniq can write a file (`sort -o F`, `uniq IN OUT`): only their printing forms pass.
      if (prog === "sort" && args.some((a) => /^-[a-zA-Z]*o/.test(a) || a.startsWith("--output"))) {
        problems.push("sort writing a file (-o/--output)");
      }
      if (prog === "uniq" && args.filter((a) => !a.startsWith("-")).length > 1) {
        problems.push("uniq with an output file");
      }
      if (prog === "sed" && !(args[0] === "-n" && /^[\d,$]+p$/.test(args[1] ?? ""))) {
        problems.push("sed other than `sed -n <range>p`");
      }
      for (const a of args) {
        if (a.startsWith("-")) continue;
        if (a.includes("/") || /\.(txt|json|md)$/.test(a)) {
          if (!inside(dir, path.resolve(cwd, a)))
            problems.push(`reads outside the request directory: ${a}`);
        }
      }
    }
  }
  return problems;
}

export function audit(traceText, requestDir, answerName = "answer.json") {
  const dir = path.resolve(requestDir);
  const answer = path.join(dir, answerName);
  const violations = [];
  let tools = null;
  let calls = 0;
  let tokens = null;
  for (const line of traceText.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      violations.push("the Trace has a line that is not JSON");
      continue;
    }
    const p = rec.payload ?? {};
    if (p.type === "tool_list_ready") tools = (p.tools ?? []).map((t) => t.name);
    if (p.type === "token_usage" && typeof p.session?.total === "number") tokens = p.session.total;
    if (p.type !== "tool_call") continue;
    calls += 1;
    let args;
    try {
      args = JSON.parse(p.arguments ?? "{}");
    } catch {
      violations.push(`${p.name}: arguments are not JSON`);
      continue;
    }
    if (p.name === "read_file") {
      // Reading the viewer itself (to see how to call it) shows no project data.
      if (!inside(dir, args.file_path ?? "") && !VIEWER.test(args.file_path ?? ""))
        violations.push(`read_file outside the request directory: ${args.file_path}`);
    } else if (p.name === "write_file") {
      if (path.resolve(dir, args.file_path ?? "") !== answer)
        violations.push(`write_file to something other than ${answerName}: ${args.file_path}`);
    } else if (p.name === "exec_command") {
      for (const problem of checkCommand(String(args.cmd ?? ""), dir))
        violations.push(`exec_command: ${problem}`);
    } else {
      violations.push(`called ${p.name}, which the answerer may not use`);
    }
  }
  if (tools === null) {
    violations.push("the Trace records no tool list");
  } else {
    const extra = tools.filter((t) => !ALLOWED_TOOLS.includes(t));
    if (extra.length > 0)
      violations.push(
        `was offered tools beyond read_file, write_file and exec_command: ${extra.join(", ")}`,
      );
  }
  return { ok: violations.length === 0, tools, calls, tokens, violations };
}

function jsonlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsonlFiles(full));
    else if (entry.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/** The first user prompt of a Trace part, or null. */
function firstPrompt(text) {
  for (const line of text.split("\n")) {
    try {
      const p = JSON.parse(line).payload ?? {};
      if (p.type === "text" && p.role === "user") return String(p.text ?? "");
    } catch {
      // not a JSON line: ignored here, reported by audit()
    }
  }
  return null;
}

/** The newest answerer session whose first prompt names the request directory: its Trace parts. */
export function findSession(tracesDir, requestDir) {
  const dir = path.resolve(requestDir);
  const sessions = new Map();
  for (const file of jsonlFiles(tracesDir)) {
    const m = path.basename(file).match(/^(.*)_(\d+)\.jsonl$/);
    if (!m) continue;
    if (!sessions.has(m[1])) sessions.set(m[1], []);
    sessions.get(m[1]).push(file);
  }
  const named = [...sessions.entries()]
    .map(([id, files]) => [id, files.sort()])
    .filter(([, files]) => {
      const prompt = firstPrompt(readFileSync(files[0], "utf8"));
      return (
        prompt !== null &&
        new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(prompt)
      );
    })
    .sort(([a], [b]) => a.localeCompare(b));
  if (named.length === 0) return null;
  const [session, files] = named[named.length - 1];
  return { session, files };
}

/** SHA-256 of this script and of the viewer beside it, so a run can show that neither changed. */
export function scriptHashes(dir = path.dirname(fileURLToPath(import.meta.url))) {
  const out = {};
  for (const f of ["audit-answerer.mjs", "print-request.mjs"]) {
    try {
      out[f] = createHash("sha256")
        .update(readFileSync(path.join(dir, f)))
        .digest("hex");
    } catch {
      out[f] = null;
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const find = argv[0] === "--traces";
  const [source, dir, name] = find ? argv.slice(1) : argv;
  let res;
  if (!source || !dir) {
    res = {
      ok: false,
      violations: [
        "usage: audit-answerer.mjs [--traces <dir> | <trace.jsonl>] <request dir> [answer file]",
      ],
    };
  } else if (find) {
    const found = findSession(source, dir);
    res = found
      ? {
          ...audit(found.files.map((f) => readFileSync(f, "utf8")).join("\n"), dir, name),
          session: found.session,
          trace_files: found.files,
        }
      : { ok: false, violations: [`no answerer session in ${source} names ${dir}`] };
  } else {
    res = audit(readFileSync(source, "utf8"), dir, name);
  }
  res.scripts_sha256 = scriptHashes();
  process.stdout.write(`${JSON.stringify(res)}\n`);
  if (!res.ok) process.exitCode = 1;
}

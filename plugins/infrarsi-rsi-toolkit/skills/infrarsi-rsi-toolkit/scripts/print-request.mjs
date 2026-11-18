#!/usr/bin/env node
// Print one file of an InfraRSI request for its answerer, a page at a time, and nothing else.
//
//   node print-request.mjs <request dir> [file] [--start N] [--lines M]
//
// `file` is a name inside the request directory (default prompt.txt); anything outside it is
// refused. A JSON file is printed as indented key: value lines, and every string that holds
// line breaks (the source files the engine embeds) is printed as a block of real lines, so the
// answerer can read code without decoding JSON itself. Lines start..start+M-1 are printed (default
// 1 and 400) after a header with the total, so a long request is read page by page.
// Read-only: it opens one file and writes only to stdout.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function render(value, indent = "") {
  const out = [];
  const put = (key, v) => {
    const head = key === null ? indent : `${indent}${key}:`;
    if (typeof v === "string" && v.includes("\n")) {
      out.push(`${head}${key === null ? "" : " "}|`);
      for (const line of v.replace(/\n$/, "").split("\n")) out.push(`${indent}  ${line}`);
    } else if (v !== null && typeof v === "object") {
      const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
      if (empty) out.push(`${head}${key === null ? "" : " "}${Array.isArray(v) ? "[]" : "{}"}`);
      else {
        if (key !== null) out.push(head);
        out.push(...render(v, `${indent}  `));
      }
    } else {
      out.push(`${head}${key === null ? "" : " "}${JSON.stringify(v)}`);
    }
  };
  if (Array.isArray(value)) value.forEach((v, i) => put(`- [${i}]`, v));
  else if (value !== null && typeof value === "object")
    for (const [k, v] of Object.entries(value)) put(k, v);
  else put(null, value);
  return out;
}

/** The file's lines as the answerer should read them: rendered JSON, or the text as it is. */
export function requestLines(dir, name = "prompt.txt") {
  const root = realpathSync(path.resolve(dir));
  const file = realpathSync(path.resolve(root, name));
  const rel = path.relative(root, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${name} is not a file inside the request directory`);
  }
  const text = readFileSync(file, "utf8");
  try {
    return render(JSON.parse(text));
  } catch {
    return text.replace(/\n$/, "").split("\n");
  }
}

export function page(lines, start = 1, count = 400) {
  const from = Math.max(1, start);
  const to = Math.min(lines.length, from + count - 1);
  return [`# lines ${from}-${to} of ${lines.length}`, ...lines.slice(from - 1, to)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (flag, dflt) => {
    const i = args.indexOf(flag);
    if (i === -1) return dflt;
    const v = Number(args.splice(i, 2)[1]);
    return Number.isInteger(v) && v > 0 ? v : dflt;
  };
  const start = opt("--start", 1);
  const count = opt("--lines", 400);
  const [dir, name] = args;
  try {
    if (!dir)
      throw new Error("usage: print-request.mjs <request dir> [file] [--start N] [--lines M]");
    process.stdout.write(`${page(requestLines(dir, name), start, count).join("\n")}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

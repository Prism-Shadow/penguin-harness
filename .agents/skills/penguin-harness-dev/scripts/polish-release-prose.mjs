#!/usr/bin/env node
/**
 * Polish release prose through a DeepSeek model on the TokenDance gateway.
 *
 * Usage: node polish.mjs <file> [--model <id>] [--write]
 *   Reads the file, sends it whole, prints the polished Markdown (or rewrites the file
 *   with --write). The key comes from TOKENDANCE_API_KEY or the file named by
 *   TOKENDANCE_KEY_FILE — never from an argument, so it stays out of shell history.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://tokendance.space/gateway/v1/chat/completions";

const INSTRUCTION = `You are editing the release notes of PenguinHarness, an open-source TypeScript harness for AI agents. The audience is developers deciding whether to upgrade.

Voice and shape — follow VS Code's release notes:
- A developer writing for developers. Plain, direct, unhyped.
- Lead each section with what changed, in one sentence. Then the detail that makes it usable.
- Concrete nouns, numbers, defaults, limits, flags and file names carry the weight. Adjectives do not.
- Short paragraphs. One idea each. Prefer a sentence over a clause pile.
- No marketing register: no "powerful", "seamless", "revolutionary", "critical", "comprehensive", "robust", "transforms", "we are excited to".
- No second-person cheerleading and no rhetorical questions.
- Em dashes are spaced: \` — \`, never \`—\`.

Hard constraints:
- Preserve every technical fact exactly: names, numbers, versions, paths, flags, defaults, limits, error codes, command lines. Never invent one, never round one, never drop one.
- **A clause is a fact too.** "produces only the CEO" and "produces a CEO" are different claims; "one standing desk session per employee" is a fact even though it contains no number. Any clause stating a default, a limit, a consequence, a scope or a reason survives the edit. If you cannot keep a sentence's facts and shorten it, keep it long.
- Preserve the Markdown structure as given: heading levels and order, image references and their alt text, code fences and their contents, link targets. Edit prose only.
- **A list stays a list.** Every line that begins with \`- \` begins with \`- \` in your answer. Do not turn a bulleted section into paragraphs, and do not turn paragraphs into bullets.
- **Do not add a heading the document does not have**, a title least of all. The document begins where it begins and ends where it ends.
- Keep the input's language. English in, English out. Chinese in, Chinese out. Do not translate.
- If a sentence is already good, leave it alone. Polishing is not rewriting.

Return only the polished Markdown. No preamble, no commentary, no fences around the whole document.`;

if (typeof INSTRUCTION !== "string") {
  // An unescaped backtick in the instruction turns this template literal into a tagged call.
  throw new Error("INSTRUCTION is not a string — check for an unescaped backtick in it");
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: polish.mjs <file> [--model <id>] [--write]");
  process.exit(2);
}
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "deepseek-v3.2";
const write = args.includes("--write");

const keyFile = process.env.TOKENDANCE_KEY_FILE;
const key = process.env.TOKENDANCE_API_KEY ?? (keyFile ? readFileSync(keyFile, "utf8").trim() : "");
if (!key) {
  console.error("no key: set TOKENDANCE_API_KEY or TOKENDANCE_KEY_FILE");
  process.exit(2);
}

const source = readFileSync(file, "utf8");

const res = await fetch(BASE, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: INSTRUCTION },
      { role: "user", content: source },
    ],
    temperature: 0.3,
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
const data = await res.json();
const out = data.choices?.[0]?.message?.content ?? "";
if (!out.trim()) {
  console.error("empty completion");
  process.exit(1);
}
// A model that ignored the "no fences" rule still produced good prose; unwrap rather than fail.
const unwrapped = out.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1");

process.stderr.write(`model=${model} usage=${JSON.stringify(data.usage ?? {})}\n`);
if (write) {
  writeFileSync(file, unwrapped.endsWith("\n") ? unwrapped : `${unwrapped}\n`);
  process.stderr.write(`wrote ${file}\n`);
} else {
  // Same trailing newline the --write path gives it, so a redirect and a rewrite agree.
  process.stdout.write(unwrapped.endsWith("\n") ? unwrapped : `${unwrapped}\n`);
}

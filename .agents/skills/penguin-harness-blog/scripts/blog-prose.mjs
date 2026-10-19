#!/usr/bin/env node
/**
 * Blog prose for penguin.ooo: every reader-facing word comes from a model on the TokenDance
 * gateway, and this script is the only way it gets there. API steps assemble one prompt pair
 * from ../prompts and ../reference, send it, and save the answer plus the raw response; local
 * steps check, strip and pair-check the drafts without touching the network.
 *
 *   node blog-prose.mjs <step> [options]
 *
 *   API steps:   outline | write | translate | polish | fix
 *   local steps: check | strip | pair
 *
 * Run with --help for the options. The key comes from TOKENDANCE_API_KEY or the file named by
 * TOKENDANCE_KEY_FILE, never from an argument, so it stays out of shell history; nothing here
 * prints it, and the saved raw JSON holds the request body and the response, not the headers.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, "..");
const PROMPTS = path.join(SKILL, "prompts");
const REFERENCE = path.join(SKILL, "reference");

const ENDPOINT = "https://tokendance.space/gateway/v1/chat/completions";
const DEFAULT_MODEL = "seed-2.1-pro";
const API_STEPS = ["outline", "write", "translate", "polish", "fix", "review"];
const LOCAL_STEPS = ["check", "strip", "pair"];
const LANG_NAME = { en: "English", zh: "Chinese" };
const CATEGORIES = ["news", "practice", "perspectives", "changelog"];
const FRONTMATTER_KEYS = ["title", "date", "category", "excerpt", "author", "pinned"];
/** 429 is the key's concurrency cap; 5xx and dropped connections are the gateway's. */
const MAX_ATTEMPTS = 6;
const BACKOFF_S = [10, 20, 40, 60, 90];

const HELP = `usage: node blog-prose.mjs <step> [options]

API steps (one gateway call each; --dry-run prints the messages instead and saves nothing):
  outline    --brief <f> --facts <f> --word-budget <text> --figure-count <text>
             [--research <f>]... [--feedback <f> --previous <f>] [--meme <f>] [--title-rule <text|@f>]
  write      --outline <f> --figures <f> --facts <f> [--meme <f>] [--title-rule <text|@f>]
  translate  --in <f> --facts <f> --to en|zh [--title-rule <text|@f>]
  polish     --in <f>
  fix        --in <f> --findings <f> --facts <f>
  review     --in <f> [--facts <f>]   numbered findings in the form fix reads; never a rewrite

  common:    --out <f>            the completion (required unless --dry-run); the raw JSON goes to
                                  <out>.raw.json, or <raw-dir>/<out name>.raw.json, or --raw <f>
             --model <id>         default ${DEFAULT_MODEL}
             --temperature <n>    default 0.3 (outline 0.5)
             --max-tokens <n>     default 32000 (reasoning counts against it)
             --lang en|zh         language produced; default from the file name (.en. / .zh.),
                                  else en (translate: --to)
             --date YYYY-MM-DD    frontmatter date; default the input's date, else today
             --version-note <t>   the verbatim note line (without "> "), or "none"; polish/fix
                                  default to the note already in the input
             --timeout <s>        per attempt, default 1800

local steps:
  check      --in <f> [--facts <f>] [--figures <manifest>] [--svg <file|dir>] [--pair <f>]
             [--assets <dir>] [--version-note <t>] [--lang en|zh]
               --figures: every manifest stem has a figure block, in order, and no others
               --svg: every string drawn in a figure source (.svg/.html) is in its figure block
  pair       --in <f> --pair <f>
  strip      --in <f> --out <f> [--assets <dir>]
               removes {F#}/{O#} markers and the model's HTML-comment notes, and turns each
               figure block into ![alt](/blog-assets/<id>-<lang>.png) + its italic caption
               (.jpg when --assets holds only that)`;

const OPTIONS = new Set([
  "out",
  "raw",
  "raw-dir",
  "model",
  "temperature",
  "max-tokens",
  "lang",
  "date",
  "version-note",
  "timeout",
  "brief",
  "facts",
  "research",
  "feedback",
  "previous",
  "meme",
  "title-rule",
  "word-budget",
  "figure-count",
  "outline",
  "figures",
  "in",
  "to",
  "findings",
  "pair",
  "with",
  "assets",
  "svg",
]);
const FLAGS = new Set(["dry-run", "help"]);
const REPEATABLE = new Set(["research"]);

/** Which option fills a slot, so an unfilled slot can say what to pass. */
const SLOT_OPTION = {
  BRIEF: "--brief",
  FACTS: "--facts",
  TERMS: "--facts (a `## TERMS` section)",
  WORD_BUDGET: "--word-budget",
  FIGURE_COUNT: "--figure-count",
  OUTLINE: "--outline",
  FIGURES: "--figures",
  FINDINGS: "--findings",
  SOURCE: "--in",
  DRAFT: "--in",
  FEEDBACK_NOTES: "--feedback",
  PREVIOUS_OUTLINE: "--previous (the outline the feedback is about)",
  MEME_BRIEF: "--meme",
};

function fail(message, code = 2) {
  process.stderr.write(`blog-prose: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const [step, ...rest] = argv;
  const opts = { research: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}" (options are --name value)`);
    const name = arg.slice(2);
    if (FLAGS.has(name)) {
      opts[name] = true;
      continue;
    }
    if (!OPTIONS.has(name)) fail(`unknown option --${name}; run with --help`);
    const value = rest[i + 1];
    if (value === undefined) fail(`--${name} needs a value`);
    i++;
    if (REPEATABLE.has(name)) opts[name].push(value);
    else opts[name] = value;
  }
  return { step, opts };
}

function read(file, what = "file") {
  if (!file) fail(`missing ${what}`);
  if (!existsSync(file)) fail(`${what} not found: ${file}`);
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

/** `@path` reads the text from a file; anything else is the text itself. */
function textOrFile(value) {
  return value.startsWith("@") ? read(value.slice(1)).trim() : value;
}

/** The last `.en.` / `-zh.` style token in a file name, so a slug containing "-en-" loses. */
function langOf(file) {
  if (!file) return undefined;
  const hits = [...path.basename(file).matchAll(/(?:^|[.\-_])(en|zh)(?=[.\-_])/g)];
  return hits.length ? hits[hits.length - 1][1] : undefined;
}

function checkLang(lang, where) {
  if (lang !== "en" && lang !== "zh") fail(`${where}: language must be en or zh, got "${lang}"`);
  return lang;
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function loadFragments() {
  const text = read(path.join(PROMPTS, "fragments.md"));
  const parts = text.split(/^<!-- fragment: ([a-z0-9-]+) -->$/m);
  const map = {};
  for (let i = 1; i < parts.length; i += 2) map[parts[i]] = parts[i + 1].trim();
  return map;
}

function styleFile(lang) {
  return read(path.join(REFERENCE, `${lang}-style.md`));
}

/** The text sent to the model: what sits between the prompt markers of the style file. */
function stylePrompt(lang) {
  const m = /<!-- prompt -->\n([\s\S]*?)\n<!-- \/prompt -->/.exec(styleFile(lang));
  if (!m) fail(`reference/${lang}-style.md has no <!-- prompt --> … <!-- /prompt --> block`);
  return m[1].trim();
}

const SLOT = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/**
 * Fill a template. `params` are prompt text (styles, the contract, fragments, option values) and
 * are expanded repeatedly, since one may name another; `content` is file content (facts, drafts,
 * outlines) and goes in last, in one pass, so a `{{…}}` inside a draft is never read as a slot.
 */
function render(template, params, content, where) {
  let text = template;
  for (let pass = 0; pass < 8; pass++) {
    const next = text.replace(SLOT, (m, name) => (name in params ? params[name] : m));
    if (next === text) break;
    text = next;
  }
  // An empty optional slot leaves a trailing space or a run of blank lines; tidy the template
  // before the content goes in, so the content itself stays byte for byte.
  text = text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  const missing = new Set();
  text = text.replace(SLOT, (m, name) => {
    if (name in content) return content[name];
    missing.add(name);
    return m;
  });
  if (missing.size) {
    const list = [...missing].map((n) => `{{${n}}}${SLOT_OPTION[n] ? ` (${SLOT_OPTION[n]})` : ""}`);
    fail(`${where}: unfilled slot ${list.join(", ")}`);
  }
  return text.trim();
}

function prompt(step, kind) {
  return read(path.join(PROMPTS, `${step}.${kind}.md`));
}

/** One `## NAME` section of a facts file, up to the next `## ` heading. */
function factsSection(facts, name) {
  const m = new RegExp(`^## ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(
    facts,
  );
  return m ? m[1].trim() : undefined;
}

function splitFrontmatter(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, metaRaw: null, body: text, bodyLine: 1 };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, metaRaw: m[1], body: text.slice(m[0].length), bodyLine: m[0].split("\n").length };
}

const VERSION_NOTE_LINE = /^> (.*PenguinHarness \d+\.\d+\.\d+.*)$/;

/** The version note a draft already carries: the first body line, when it is the boilerplate. */
function versionNoteOf(doc) {
  const first = doc.body.split("\n").find((l) => l.trim() !== "");
  const m = first ? VERSION_NOTE_LINE.exec(first.trim()) : null;
  return m ? m[1] : undefined;
}

function contractParams(fragments, { lang, date, versionNote }) {
  const params = { LANG: lang, DATE: date };
  if (versionNote && versionNote !== "none") {
    params.VERSION_NOTE_RULE = fragments["version-note-rule"];
    params.VERSION_NOTE = versionNote;
  } else {
    params.VERSION_NOTE_RULE = fragments["no-version-note"];
  }
  params.MARKDOWN_CONTRACT = read(path.join(PROMPTS, "markdown-contract.md")).trim();
  return params;
}

/** The translation tells for a language; the zh list reuses the style guide's own 翻译腔 line. */
function tells(F, lang) {
  const out = { TELLS: F[`tells-${lang}`] };
  if (lang === "zh") {
    const line = stylePrompt("zh")
      .split("\n")
      .find((l) => l.startsWith("- 翻译腔"));
    if (!line) fail("reference/zh-style.md lost its `- 翻译腔` line, which the zh tells reuse");
    out.ZH_TRANSLATIONESE = line;
  }
  return out;
}

function researchText(files) {
  if (!files.length) return "(none)";
  return files
    .map((f) => `### ${path.basename(f)}\n\n${read(f, "--research").trim()}`)
    .join("\n\n");
}

function buildMessages(step, o) {
  const F = loadFragments();
  const params = {};
  const content = {};
  let lang;

  if (o.meme) {
    params.MEME_BRIEF_SECTION = F["meme-brief"];
    content.MEME_BRIEF = read(o.meme, "--meme").trim();
  } else {
    params.MEME_BRIEF_SECTION = "";
  }
  if (o.facts) content.FACTS = read(o.facts, "--facts").trim();
  const titleRule = o["title-rule"] !== undefined ? textOrFile(o["title-rule"]) : undefined;

  switch (step) {
    case "outline": {
      lang = checkLang(o.lang ?? langOf(o.out) ?? "en", "--lang");
      params.STYLE = stylePrompt(lang);
      params.LANG_NAME = LANG_NAME[lang];
      params.TITLE_RULE = titleRule ?? "";
      if (o["word-budget"] !== undefined) params.WORD_BUDGET = o["word-budget"];
      if (o["figure-count"] !== undefined) params.FIGURE_COUNT = o["figure-count"];
      if (o.brief) content.BRIEF = read(o.brief, "--brief").trim();
      content.RESEARCH_SUMMARY = researchText(o.research);
      if (o.feedback) {
        params.FEEDBACK = F["outline-feedback"];
        content.FEEDBACK_NOTES = read(o.feedback, "--feedback").trim();
        if (o.previous) content.PREVIOUS_OUTLINE = read(o.previous, "--previous").trim();
      } else {
        if (o.previous) fail("--previous only goes with --feedback");
        params.FEEDBACK = "";
      }
      break;
    }
    case "write": {
      lang = checkLang(o.lang ?? langOf(o.out) ?? "en", "--lang");
      params.STYLE = stylePrompt(lang);
      params.LANG_NAME = LANG_NAME[lang];
      params.TITLE_RULE = titleRule ?? "";
      Object.assign(
        params,
        contractParams(F, { lang, date: o.date ?? today(), versionNote: o["version-note"] }),
      );
      if (o.outline) content.OUTLINE = read(o.outline, "--outline").trim();
      if (o.figures) content.FIGURES = read(o.figures, "--figures").trim();
      break;
    }
    case "translate": {
      if (!o.to) fail("translate needs --to en|zh");
      lang = checkLang(o.to, "--to");
      const source = read(o.in, "--in");
      const sourceLang = langOf(o.in) ?? (lang === "en" ? "zh" : "en");
      if (sourceLang === lang) fail(`--in is already ${lang}; --to names the other language`);
      const doc = splitFrontmatter(source);
      const sourceNote = versionNoteOf(doc);
      if (sourceNote && o["version-note"] === undefined) {
        fail(
          `the source carries a version note ("${sourceNote}"); pass --version-note with the ${LANG_NAME[lang]} line, or "none"`,
        );
      }
      params.STYLE_TARGET = stylePrompt(lang);
      params.TARGET_LANG_NAME = LANG_NAME[lang];
      params.SOURCE_LANG_NAME = LANG_NAME[sourceLang];
      params.SOURCE_LANG = sourceLang;
      params.TITLE_RULE = titleRule ?? F[`title-rule-translate-${lang}`];
      Object.assign(
        params,
        contractParams(F, {
          lang,
          date: o.date ?? doc.meta.date ?? today(),
          versionNote: o["version-note"],
        }),
      );
      content.SOURCE = source.trim();
      if (content.FACTS !== undefined) {
        const terms = factsSection(content.FACTS, "TERMS");
        if (terms !== undefined) content.TERMS = terms;
      }
      break;
    }
    case "polish":
    case "fix": {
      const draft = read(o.in, "--in");
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      const doc = splitFrontmatter(draft);
      const note = o["version-note"] ?? versionNoteOf(doc);
      params[step === "polish" ? "STYLE_TARGET" : "STYLE"] = stylePrompt(lang);
      params.LANG_NAME = LANG_NAME[lang];
      Object.assign(
        params,
        contractParams(F, { lang, date: o.date ?? doc.meta.date ?? today(), versionNote: note }),
      );
      if (step === "polish") Object.assign(params, tells(F, lang));
      else if (o.findings) content.FINDINGS = read(o.findings, "--findings").trim();
      content.DRAFT = draft.trim();
      break;
    }
    case "review": {
      const draft = read(o.in, "--in");
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      params.STYLE = stylePrompt(lang);
      params.LANG_NAME = LANG_NAME[lang];
      Object.assign(params, tells(F, lang));
      // Fragments are trimmed; the rule follows a sentence and the section precedes a heading.
      params.FACTS_RULE = content.FACTS !== undefined ? ` ${F["review-facts-rule"]}` : "";
      params.FACTS_SECTION = content.FACTS !== undefined ? `${F["review-facts-section"]}\n\n` : "";
      content.DRAFT = draft.trim();
      break;
    }
    default:
      fail(`unknown step "${step}"`);
  }

  const system = render(prompt(step, "system"), params, content, `${step}.system.md`);
  const user = render(prompt(step, "user"), params, content, `${step}.user.md`);
  return { lang, system, user };
}

// ---------------------------------------------------------------------------
// The gateway call
// ---------------------------------------------------------------------------

function readKey() {
  const fromEnv = process.env.TOKENDANCE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.TOKENDANCE_KEY_FILE;
  if (file) {
    if (!existsSync(file)) fail("TOKENDANCE_KEY_FILE names a file that does not exist");
    const key = readFileSync(file, "utf8").trim();
    if (key) return key;
  }
  fail("no key: set TOKENDANCE_API_KEY or TOKENDANCE_KEY_FILE");
}

/** node:https rather than fetch: fetch gives up after 300 s without headers, and a reasoning call can take longer. */
function post(key, body, timeoutS) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutS * 1000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no response within ${timeoutS} s`)));
    req.on("error", reject);
    req.end(body);
  });
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

function unwrapFence(text) {
  const m = /^```(?:markdown|md)?\n([\s\S]*)\n```$/.exec(text.trim());
  return m ? m[1] : text.trim();
}

async function callApi(step, o, messages) {
  const key = readKey();
  const request = {
    model: o.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    temperature: Number(o.temperature ?? (step === "outline" ? 0.5 : 0.3)),
    max_tokens: Number(o["max-tokens"] ?? 32000),
  };
  const timeoutS = Number(o.timeout ?? 1800);
  const body = JSON.stringify(request);
  const rawPath =
    o.raw ??
    (o["raw-dir"]
      ? path.join(o["raw-dir"], `${path.basename(o.out)}.raw.json`)
      : `${o.out}.raw.json`);

  const started = Date.now();
  let res;
  for (let attempt = 1; ; attempt++) {
    let error;
    try {
      res = await post(key, body, timeoutS);
    } catch (err) {
      error = err;
    }
    const retryable = error || res.status === 429 || res.status >= 500;
    if (!retryable) break;
    const why = error ? error.message : `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
    if (attempt >= MAX_ATTEMPTS) fail(`${why} (gave up after ${attempt} attempts)`, 1);
    const wait = BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)];
    process.stderr.write(
      `${why}; retrying in ${wait} s (attempt ${attempt + 1}/${MAX_ATTEMPTS})\n`,
    );
    await sleep(wait);
  }
  const elapsedS = Math.round((Date.now() - started) / 1000);

  if (res.status !== 200) {
    const hint =
      res.status === 401 || res.status === 403
        ? " (invalid_model / model_access_denied mean the key cannot use this model)"
        : "";
    fail(`HTTP ${res.status}${hint}: ${res.body.slice(0, 400)}`, 1);
  }
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    fail(`the gateway answered 200 with a body that is not JSON: ${res.body.slice(0, 400)}`, 1);
  }

  mkdirSync(path.dirname(path.resolve(rawPath)), { recursive: true });
  writeFileSync(
    rawPath,
    `${JSON.stringify({ step, elapsed_s: elapsedS, request, response: data }, null, 2)}\n`,
  );

  const choice = data.choices?.[0];
  const finish = choice?.finish_reason;
  const usage = data.usage ?? {};
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  process.stderr.write(
    `model=${data.model ?? request.model} finish=${finish} elapsed=${elapsedS}s ` +
      `prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` +
      `${reasoning !== undefined ? ` reasoning=${reasoning}` : ""} total=${usage.total_tokens}\n` +
      `raw: ${rawPath}\n`,
  );
  if (finish === "length") {
    fail(`finish_reason "length": the answer was cut off at max_tokens; nothing written`, 1);
  }
  if (finish && finish !== "stop" && finish !== "end_turn") {
    fail(`finish_reason "${finish}"; nothing written`, 1);
  }
  const text = choice?.message?.content ?? "";
  if (!text.trim()) fail("empty completion; nothing written", 1);

  const out = `${unwrapFence(text)}\n`;
  mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  writeFileSync(o.out, out);
  process.stderr.write(`wrote ${o.out}\n`);
  if (step !== "outline" && step !== "review" && !out.startsWith("---\n")) {
    process.stderr.write("note: the answer does not start with frontmatter; run check on it\n");
  }
}

// ---------------------------------------------------------------------------
// Document model for the local steps
// ---------------------------------------------------------------------------

const MARKER = /\{[FO]\d+\}/g;
const FOOTER = /^\*\*(Sources|来源|参考来源|参考资料)\*\*\s*[:：]/;
const IMAGE_LINE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/;
const CAPTION = /^(_[^_\s][^\n]*_|\*[^*\s][^\n]*\*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";

const FIGURE_OPEN = /^```figure\b(.*)$/;
const SPEC_KEY = /^\s*([a-z_]+)\s*:\s*(.*)$/;
const SPEC_ITEM = /^\s*-\s+(.*)$/;
const STEM = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

function unquote(value) {
  const v = value.trim();
  return /^"[^"]*"$|^'[^']*'$/.test(v) ? v.slice(1, -1).trim() : v;
}

/** One line inside a ```figure block: a `key: value`, or a `- <where>: <string>` under `text:`. */
function parseSpecLine(fig, line, n) {
  const item = SPEC_ITEM.exec(line);
  if (item && fig.inText) {
    const m = /^([a-z][a-z-]*(?: [a-z][a-z-]*)?):\s+(.+)$/.exec(item[1].trim());
    fig.text.push({ where: m?.[1], value: unquote(m ? m[2] : item[1]), n });
    return;
  }
  const kv = SPEC_KEY.exec(line);
  if (kv) {
    const [, key, value] = kv;
    fig.inText = key === "text";
    if (["alt", "caption", "title", "kind"].includes(key)) fig[key] = unquote(value);
    else if (key !== "text") fig.unknown.push({ key, n });
    else if (value.trim()) fig.unknown.push({ key: "text (items go on their own - lines)", n });
    return;
  }
  if (line.trim()) fig.unknown.push({ key: `unparsed line "${line.trim().slice(0, 40)}"`, n });
}

/** Every string a figure block lets the picture show. */
function specStrings(fig) {
  return [fig.title, fig.alt, fig.caption, ...fig.text.map((t) => t.value)].filter(Boolean);
}

/** Split a document into typed lines with their file line numbers; fenced code is opaque. */
function parseDoc(file) {
  const raw = read(file, "--in");
  const doc = splitFrontmatter(raw);
  const lines = doc.body.split("\n");
  const items = [];
  const figures = [];
  let fence = null;
  let fig = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = doc.bodyLine + i;
    const fenceMark = /^\s*(```+|~~~+)/.exec(line);
    if (fig) {
      items.push({ type: "figure", line, n });
      if (/^\s*```\s*$/.test(line)) {
        fig.closed = true;
        fig.end = n;
        fig = null;
      } else parseSpecLine(fig, line, n);
      continue;
    }
    const figOpen = !fence && FIGURE_OPEN.exec(line.trim());
    if (figOpen) {
      const id = /\bid\s*=\s*"?([^\s"`]+)"?/.exec(figOpen[1])?.[1];
      fig = { id, n, text: [], unknown: [], closed: false, inText: false };
      figures.push(fig);
      items.push({ type: "figure", line, n });
      continue;
    }
    if (fence) {
      items.push({ type: "code", line, n, fenceEnd: !!fenceMark && fenceMark[1][0] === fence[0] });
      if (fenceMark && fenceMark[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      items.push({ type: "fence", line, n });
      continue;
    }
    let type = "text";
    if (line.trim() === "") type = "blank";
    else if (HEADING.test(line)) type = "heading";
    else if (IMAGE_LINE.test(line.trim())) type = "image";
    else if (CAPTION.test(line.trim())) type = "caption";
    else if (FOOTER.test(line.trim())) type = "footer";
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) type = "rule";
    else if (/^\s*<!--/.test(line)) type = "comment";
    else if (/^\s*\|/.test(line)) type = "table";
    else if (/^\s*>/.test(line)) type = "quote";
    else if (LIST_ITEM.test(line)) type = "list";
    items.push({ type, line, n });
  }
  // A comment may span lines; mark the continuation lines too.
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== "comment") continue;
    let j = i;
    while (!items[j].line.includes("-->") && j + 1 < items.length) {
      j++;
      items[j].type = "comment";
    }
    i = j;
  }
  return { file, raw, ...doc, items, figures, unclosedFence: fence !== null };
}

/** Figure strings as pseudo-lines, so the language rules read them like prose. */
function figureLines(doc) {
  return doc.figures.flatMap((f) =>
    [
      ["title", f.title],
      ["alt", f.alt],
      ["caption", f.caption],
    ]
      .filter(([, v]) => v)
      .map(([, v]) => ({ type: "figtext", line: v, n: f.n }))
      .concat(f.text.map((t) => ({ type: "figtext", line: t.value, n: t.n }))),
  );
}

/** Code spans, then link targets, then quotations, replaced by neutral placeholders. */
function maskProse(text, { quotes = false } = {}) {
  let t = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, " ⟦code⟧ ");
  t = t.replace(/\]\([^)]*\)/g, "]");
  t = t.replace(/https?:\/\/[^\s)<>\]」，。]+/g, " ⟦url⟧ ");
  if (quotes) t = t.replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/g, " ⟦quote⟧ ");
  return t;
}

function paragraphs(doc) {
  const out = [];
  let cur = null;
  for (const it of doc.items) {
    if (it.type === "text" || it.type === "list" || it.type === "quote") {
      const startsNew = it.type === "list" || !cur || cur.type !== it.type;
      if (startsNew) {
        cur = {
          type: it.type,
          n: it.n,
          text: it.line.replace(LIST_ITEM, "").replace(/^\s*>\s?/, ""),
        };
        out.push(cur);
      } else {
        cur.text += ` ${it.line.trim()}`;
      }
    } else {
      cur = null;
    }
  }
  return out;
}

/** Sentences of one paragraph, each keeping the markers written right after it. */
function sentences(text) {
  const masked = text
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => m.replace(/[.!?。！？]/g, "\u0001"))
    .replace(/\]\([^)]*\)/g, (m) => m.replace(/[.!?]/g, "\u0001"))
    .replace(/https?:\/\/\S+/g, (m) => m.replace(/[.!?]/g, "\u0001"))
    .replace(/(\w)\.(?=\w)/g, "$1\u0001")
    .replace(/\b(e\.g|i\.e|etc|vs|cf)\./gi, (m) => m.replace(/\./g, "\u0001"));
  return masked
    .replace(/([.!?。！？]+["”’」』)）\]]*)((?:\s*\{[FO]\d+\})*)\s*/g, "$1$2\n")
    .split("\n")
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

function loadFacts(file) {
  const text = read(file, "--facts");
  const ids = new Set();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:\|\s*)?(?:[-*]\s*)?(?:\*\*)?`?\{?([FO]\d+)\}?`?(?:\*\*)?\s*[.:)|：—-]/.exec(
      line,
    );
    if (m) ids.add(m[1]);
  }
  const urls = new Set(
    [...text.matchAll(/https?:\/\/[^\s)<>\]」，。`"]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")),
  );
  const terms = [];
  const termsText = factsSection(text, "TERMS") ?? "";
  for (const line of termsText.split("\n")) {
    let term;
    if (/^\s*\|/.test(line) && !/^\s*\|\s*:?-{3,}/.test(line)) term = line.split("|")[1];
    else if (/^\s*[-*]\s+/.test(line))
      term = line.replace(/^\s*[-*]\s+/, "").split(/ — |: |：|\(|（/)[0];
    term = term?.replace(/[`*]/g, "").trim();
    if (term && term.length >= 3 && !/^(term|terms|en|english|名词|术语)$/i.test(term))
      terms.push(term);
  }
  return { text, ids, urls, terms };
}

function codeSpans(doc) {
  const spans = [];
  let block = null;
  for (const it of doc.items) {
    if (it.type === "fence") {
      block = [];
      continue;
    }
    if (it.type === "code") {
      if (it.fenceEnd) {
        spans.push(block.join("\n"));
        block = null;
      } else block?.push(it.line);
      continue;
    }
    if (it.type === "figure") continue;
    for (const m of it.line.matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/g)) spans.push(m[2].trim());
  }
  return spans;
}

function urlsOf(doc) {
  const out = [];
  for (const it of doc.items) {
    if (it.type === "code" || it.type === "fence" || it.type === "image") continue;
    for (const m of it.line.matchAll(/https?:\/\/[^\s)<>\]」，。]+/g)) {
      out.push(m[0].replace(/[.,;:]+$/, ""));
    }
  }
  return out;
}

function numbersOf(doc) {
  const out = [];
  for (const it of [...doc.items, ...figureLines(doc)]) {
    if (!["text", "list", "quote", "table", "heading", "caption", "figtext"].includes(it.type))
      continue;
    const t = maskProse(it.line).replace(MARKER, " ");
    for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) out.push(m[0].replace(/,(?=\d{3}\b)/g, ""));
  }
  return out;
}

function images(doc) {
  return doc.items
    .filter((it) => it.type === "image")
    .map((it) => {
      const [, alt, src] = IMAGE_LINE.exec(it.line.trim());
      const m = /^\/blog-assets\/(.+)-(en|zh)\.(png|jpe?g|gif|webp|svg)$/.exec(src);
      return { n: it.n, alt, src, stem: m?.[1], lang: m?.[2], ext: m?.[3] };
    });
}

function multisetDiff(a, b) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const onlyA = [];
  const onlyB = [];
  for (const [k, v] of ca) for (let i = cb.get(k) ?? 0; i < v; i++) onlyA.push(k);
  for (const [k, v] of cb) for (let i = ca.get(k) ?? 0; i < v; i++) onlyB.push(k);
  return { onlyA, onlyB };
}

function loadPatterns(lang) {
  const text = styleFile(lang);
  const section = text.split(/^## Check patterns$/m)[1] ?? "";
  const out = { error: [], warn: [] };
  let level = null;
  for (const line of section.split("\n")) {
    if (/^### Errors/.test(line)) level = "error";
    else if (/^### Warnings/.test(line)) level = "warn";
    const m = /^- `\/(.*)\/([a-z]*)` — (.*)$/.exec(line);
    if (m && level) out[level].push({ re: new RegExp(m[1], m[2].replace("g", "")), label: m[3] });
  }
  if (!out.error.length) fail(`reference/${lang}-style.md: no check patterns under "### Errors"`);
  return out;
}

// ---------------------------------------------------------------------------
// check / pair / strip
// ---------------------------------------------------------------------------

/** Figure stems a manifest names: a table's first column, or `id: <stem>` / `id=<stem>`. */
function manifestStems(text) {
  const stems = [];
  for (const line of text.split("\n")) {
    let stem = /\bid\s*[=:]\s*`?([a-z0-9]+(?:-[a-z0-9]+)+)`?/.exec(line)?.[1];
    if (!stem && /^\s*\|/.test(line) && !/^\s*\|\s*:?-{3,}/.test(line)) {
      const cell = line.split("|")[1].replace(/[`*]/g, "").trim();
      if (STEM.test(cell)) stem = cell;
    }
    if (stem && !stems.includes(stem)) stems.push(stem);
  }
  return stems;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Whitespace collapsed, and dropped between two CJK characters (a line break inside a label). */
function normalizeText(text) {
  return text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) =>
      e[0] === "#"
        ? String.fromCodePoint(
            parseInt(
              e.slice(e[1] === "x" || e[1] === "X" ? 2 : 1),
              e[1] === "x" || e[1] === "X" ? 16 : 10,
            ),
          )
        : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .replace(
      new RegExp(
        `(?<=[${CJK}\\u3000-\\u303f\\uff00-\\uffef]) (?=[${CJK}\\u3000-\\u303f\\uff00-\\uffef])`,
        "g",
      ),
      "",
    )
    .trim();
}

/**
 * Every string a figure source draws. An SVG `<text>` (with its `<tspan>` lines), `<title>` or
 * `<desc>` is one string; in HTML, inline tags are transparent, `<br>` is a space, and every
 * other tag ends a string. `<head>`, `<style>`, `<script>` and comments draw nothing.
 */
function drawnStrings(markup) {
  const out = [];
  let t = markup
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    out.push(inner.replace(/<[^>]+>/g, " "));
    return " ";
  });
  t = t
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(span|b|strong|em|i|code|sub|sup|small|a|tspan)\b[^>]*>/gi, "");
  for (const run of t.split(/<[^>]*>/)) out.push(run);
  return out.map(normalizeText).filter(Boolean);
}

/** Fail every drawn string that is not in its figure's block; the block's words are the API's. */
function checkDrawn(doc, lang, target, r) {
  const specs = doc.figures.filter((f) => f.id);
  if (!existsSync(target)) {
    r.add("error", null, `--svg: not found: ${target}`);
    return;
  }
  const isDir = statSync(target).isDirectory();
  const files = isDir
    ? readdirSync(target)
        .filter((f) => /\.(svg|html?)$/i.test(f))
        .map((f) => path.join(target, f))
    : [target];
  const specFor = (file) => {
    const base = path.basename(file);
    const matches = specs.filter(
      (f) => base.startsWith(f.id) && /^[.\-_]/.test(base.slice(f.id.length)),
    );
    return matches.sort((a, b) => b.id.length - a.id.length)[0];
  };
  const drawn = new Set();
  for (const file of files) {
    const fileLang = langOf(file);
    if (isDir && fileLang && fileLang !== lang) continue;
    const fig = specFor(file);
    if (!fig) {
      r.add("error", null, `${file}: no figure block in ${path.basename(doc.file)} has its id`);
      continue;
    }
    drawn.add(fig.id);
    const allowed = new Set(specStrings(fig).map(normalizeText));
    const strings = drawnStrings(readFileSync(file, "utf8"));
    const shown = new Set();
    for (const s of strings) {
      if (allowed.has(s)) shown.add(s);
      else
        r.add(
          "error",
          null,
          `${path.basename(file)}: "${s.slice(0, 80)}" is not in figure ${fig.id}'s block`,
        );
    }
    for (const t of fig.text) {
      if (!shown.has(normalizeText(t.value)))
        r.add(
          "warn",
          t.n,
          `figure ${fig.id}: "${t.value}" is in the block but not drawn in ${path.basename(file)}`,
        );
    }
  }
  if (isDir) {
    for (const fig of specs) {
      if (fig.text.length && !drawn.has(fig.id))
        r.add("warn", fig.n, `figure ${fig.id}: no drawn source for it in ${target}`);
    }
  }
}

function reporter(file) {
  const hits = [];
  const add = (level, n, msg) => hits.push({ level, n, msg });
  const print = () => {
    hits.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
    for (const h of hits) {
      const where = h.n ? `${file}:${h.n}` : file;
      process.stdout.write(`${h.level === "error" ? "ERROR" : "WARN "} ${where}  ${h.msg}\n`);
    }
    return hits.filter((h) => h.level === "error").length;
  };
  return { add, print, hits };
}

function checkDoc(doc, lang, o, r, facts) {
  const { meta, metaRaw, items } = doc;
  const prose = (t) => maskProse(t, { quotes: true });

  // Frontmatter
  if (metaRaw === null) {
    r.add("error", 1, "no frontmatter (--- … ---) at the top");
  } else {
    for (const k of ["title", "date", "category", "excerpt"]) {
      if (!meta[k]) r.add("error", 1, `frontmatter: missing ${k}`);
    }
    for (const line of metaRaw.split("\n")) {
      const key = line.split(":")[0].trim();
      if (key && !FRONTMATTER_KEYS.includes(key))
        r.add("warn", 1, `frontmatter: unknown key "${key}"`);
      if ((key === "title" || key === "excerpt") && !/^\w+:\s*".*"\s*$/.test(line)) {
        r.add("warn", 1, `frontmatter: ${key} is not double-quoted`);
      }
      if (/\\"/.test(line))
        r.add("error", 1, `frontmatter: \\" is not unescaped by the blog parser (${key})`);
    }
    if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date))
      r.add("error", 1, `frontmatter: date "${meta.date}" is not YYYY-MM-DD`);
    if (meta.category && !CATEGORIES.includes(meta.category)) {
      r.add(
        "error",
        1,
        `frontmatter: category "${meta.category}" is not one of ${CATEGORIES.join(", ")}`,
      );
    }
    if (MARKER.test(metaRaw)) r.add("error", 1, "frontmatter carries a fact marker");
    MARKER.lastIndex = 0;
    if (meta.excerpt) {
      const size =
        lang === "zh"
          ? meta.excerpt.replace(/\s/g, "").length
          : meta.excerpt.split(/\s+/).filter(Boolean).length;
      const cap = lang === "zh" ? 90 : 60;
      if (size > cap)
        r.add(
          "warn",
          1,
          `excerpt is ${size} ${lang === "zh" ? "characters" : "words"} (cap ${cap})`,
        );
    }
  }

  const content = items.filter((it) => it.type !== "blank");
  // Version note
  const note = o["version-note"];
  if (note && note !== "none") {
    if (!content[0] || content[0].line.trim() !== `> ${note}`) {
      r.add("error", content[0]?.n, `the first body line is not the version note "> ${note}"`);
    }
  }
  // Lead
  const firstNonNote = content.find(
    (it) => !(it.type === "quote" && VERSION_NOTE_LINE.test(it.line.trim())),
  );
  if (firstNonNote && firstNonNote.type === "heading")
    r.add("error", firstNonNote.n, "no lead paragraph before the first heading");

  // Headings
  const h2 = items.filter((it) => it.type === "heading" && it.line.startsWith("## "));
  for (const it of items.filter((x) => x.type === "heading")) {
    const level = HEADING.exec(it.line)[1].length;
    if (level === 1) r.add("error", it.n, "an H1 in the body (the title lives in the frontmatter)");
    if (level >= 3) r.add("error", it.n, `"${"#".repeat(level)}" heading (only ## is allowed)`);
    if (
      /^#+\s+(\d+[.)、:]|[一二三四五六七八九十]+[、.．]|(step|part|section) \d+\b)/i.test(it.line)
    ) {
      r.add("error", it.n, "numbered heading");
    }
    if (it.line.match(MARKER)) r.add("error", it.n, "fact marker in a heading");
  }
  if (h2.length < 4 || h2.length > 6)
    r.add("error", null, `${h2.length} sections (## headings); the contract asks for 4 to 6`);
  const colonHeads = h2.filter((it) => /[:：]/.test(it.line));
  if (colonHeads.length > 1)
    r.add("error", colonHeads[1].n, `${colonHeads.length} headings contain a colon (at most one)`);

  // Images and captions
  const imgs = images(doc);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type !== "image") {
      if (it.type !== "code" && /!\[[^\]]*\]\(/.test(it.line))
        r.add("error", it.n, "an image inside a paragraph (images stand on their own line)");
      continue;
    }
    const img = imgs.find((x) => x.n === it.n);
    if (!img.alt.trim()) r.add("error", it.n, "image without alt text");
    if (
      /^(an? )?(image|picture|screenshot|photo) of\b/i.test(img.alt) ||
      /^(图片|截图|图)[：:]/.test(img.alt)
    ) {
      r.add("warn", it.n, `alt text starts with "${img.alt.split(" ").slice(0, 3).join(" ")}"`);
    }
    if (img.alt.match(MARKER)) r.add("error", it.n, "fact marker in alt text");
    if (!img.src.startsWith("/blog-assets/"))
      r.add("error", it.n, `image path "${img.src}" is not /blog-assets/<name>`);
    else if (!img.lang) r.add("error", it.n, `image path "${img.src}" has no -en/-zh suffix`);
    else if (img.lang !== lang)
      r.add("error", it.n, `image path "${img.src}" carries -${img.lang} in a ${lang} post`);
    if (o.assets && img.src.startsWith("/blog-assets/")) {
      const local = path.join(o.assets, img.src.slice("/blog-assets/".length));
      if (!existsSync(local)) r.add("error", it.n, `image not found under --assets: ${local}`);
    }
    const next = items[i + 1];
    if (!next || next.type !== "caption")
      r.add("error", it.n, "image without an italic caption on the next line");
    else {
      if (next.line.match(MARKER)) r.add("error", next.n, "fact marker in a caption");
      const after = items[i + 2];
      if (after && after.type !== "blank") r.add("warn", next.n, "no blank line after the caption");
    }
  }

  // Figure blocks: the only source of the words inside a figure.
  const seen = new Set();
  for (const fig of doc.figures) {
    if (!fig.id) r.add("error", fig.n, "figure block without id=<stem>");
    else if (!STEM.test(fig.id))
      r.add("error", fig.n, `figure id "${fig.id}" is not a lowercase hyphenated stem`);
    else if (seen.has(fig.id)) r.add("error", fig.n, `figure id "${fig.id}" appears twice`);
    seen.add(fig.id);
    if (!fig.closed) r.add("error", fig.n, "figure block is never closed with ```");
    if (!fig.alt) r.add("error", fig.n, `figure ${fig.id}: no alt`);
    if (!fig.caption) r.add("error", fig.n, `figure ${fig.id}: no caption`);
    if (
      fig.alt &&
      (/^(an? )?(image|picture|screenshot|photo) of\b/i.test(fig.alt) ||
        /^(图片|截图|图)[：:]/.test(fig.alt))
    ) {
      r.add(
        "warn",
        fig.n,
        `figure ${fig.id}: alt starts with "${fig.alt.split(" ").slice(0, 3).join(" ")}"`,
      );
    }
    for (const u of fig.unknown)
      r.add(
        "warn",
        u.n,
        `figure ${fig.id}: ${u.key.includes(" ") ? u.key : `unknown key "${u.key}"`}`,
      );
    for (const t of fig.text)
      if (!t.value) r.add("error", t.n, `figure ${fig.id}: empty text item`);
  }
  for (const it of items.filter((x) => x.type === "figure")) {
    if (it.line.match(MARKER)) r.add("error", it.n, "fact marker inside a figure block");
  }
  if (doc.figures.length && images(doc).length) {
    r.add(
      "warn",
      null,
      "the post mixes figure blocks and image lines (a draft holds blocks; strip turns them into images)",
    );
  }
  if (o.figures) {
    const want = manifestStems(read(o.figures, "--figures"));
    if (!want.length)
      r.add(
        "error",
        null,
        `no figure stems found in ${o.figures} (a table whose first column is the stem, or id: <stem> lines)`,
      );
    const have = doc.figures
      .map((f) => f.id)
      .filter(Boolean)
      .concat(
        images(doc)
          .map((im) => im.stem)
          .filter(Boolean),
      );
    for (const stem of want)
      if (!have.includes(stem))
        r.add("error", null, `figure ${stem} is in the manifest but has no figure block`);
    for (const stem of have)
      if (!want.includes(stem)) r.add("error", null, `figure ${stem} is not in the manifest`);
    const order = have.filter((s) => want.includes(s));
    if (order.join() !== want.filter((s) => have.includes(s)).join()) {
      r.add("error", null, `figures are out of manifest order: ${order.join(", ")}`);
    }
  }
  if (o.svg) checkDrawn(doc, lang, o.svg, r);

  // Footer, rules, comments
  const footers = items.filter((it) => it.type === "footer");
  if (footers.length === 0) r.add("error", null, "no **Sources** footer line");
  if (footers.length > 1) r.add("error", footers[1].n, "more than one **Sources** footer");
  const footer = footers[0];
  if (footer) {
    const after = items.filter(
      (it) => it.n > footer.n && it.type !== "blank" && it.type !== "comment",
    );
    if (after.length) r.add("error", after[0].n, "content after the **Sources** footer");
    if (footer.line.match(MARKER)) r.add("error", footer.n, "fact marker in the footer");
    if (facts) {
      for (const m of footer.line.matchAll(/\]\((\S+?)\)/g)) {
        if (!facts.urls.has(m[1])) r.add("error", footer.n, `footer URL not in FACTS: ${m[1]}`);
      }
    }
  }
  for (const it of items.filter((x) => x.type === "rule")) {
    const next = items.find((x) => x.n > it.n && x.type !== "blank");
    if (!next || next.type !== "footer")
      r.add("error", it.n, "horizontal rule (only one, directly before the footer, is allowed)");
  }
  const comments = items.filter((it) => it.type === "comment");
  for (const it of comments) {
    const rest = items.filter((x) => x.n > it.n && x.type !== "blank" && x.type !== "comment");
    if (rest.length)
      r.add("error", it.n, "HTML comment inside the post (notes belong at the very end)");
    else if (it.line.trim().startsWith("<!--"))
      r.add("warn", it.n, `model note: ${it.line.trim()}`);
  }

  // Forbidden syntax
  for (const it of items) {
    if (it.type === "code" || it.type === "fence" || it.type === "comment") continue;
    const t = it.line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, "");
    if (/\]\(#/.test(t)) r.add("error", it.n, "in-page anchor link ](#…)");
    if (/^\s*:::/.test(t)) r.add("error", it.n, "callout syntax :::");
    if (/<\/?[a-zA-Z][^>]*>/.test(t)) r.add("error", it.n, "raw HTML");
    if (EMOJI.test(t)) r.add("error", it.n, "emoji");
    if (/\{\{[A-Z_]+\}\}/.test(t))
      r.add("error", it.n, "an unfilled template slot leaked into the post");
    if (it.type === "table" && !/^\s*\|\s*:?-{3,}/.test(it.line)) {
      const cols = it.line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|").length;
      if (cols > 4) r.add("error", it.n, `table row with ${cols} columns (at most 4)`);
    }
  }
  if (doc.unclosedFence) r.add("error", null, "unbalanced code fence");

  // Lists longer than five items
  let run = [];
  const flush = () => {
    if (run.length > 5)
      r.add(
        lang === "en" ? "error" : "warn",
        run[0].n,
        `a list of ${run.length} items (at most five)`,
      );
    run = [];
  };
  for (const it of items) {
    if (it.type === "list" && /^[-*+]/.test(it.line)) run.push(it);
    else if (it.type !== "blank" || run.length === 0) flush();
  }
  flush();

  // Markers
  const used = new Set();
  for (const it of items) for (const m of it.line.matchAll(/\{([FO]\d+)\}/g)) used.add(m[1]);
  const hasMarkers = used.size > 0;
  if (facts && hasMarkers) {
    for (const id of used)
      if (!facts.ids.has(id)) r.add("error", null, `marker {${id}} is not an id in the facts file`);
  }
  const paras = paragraphs(doc).filter(
    (p) => !(p.type === "quote" && VERSION_NOTE_LINE.test(`> ${p.text}`)),
  );
  if (hasMarkers) {
    const missing = [];
    for (const p of paras) {
      for (const s of sentences(p.text)) {
        if (s.match(MARKER)) continue;
        const bare = maskProse(s);
        const why = /⟦code⟧/.test(bare)
          ? "code span"
          : /⟦url⟧|\]\(/.test(s)
            ? "link"
            : /\d/.test(bare)
              ? "number"
              : facts?.terms.find((t) => s.includes(t));
        if (why) missing.push({ n: p.n, why, s });
      }
    }
    for (const m of missing.slice(0, 40)) {
      r.add(
        "warn",
        m.n,
        `no marker on a sentence with a ${m.why}: "${m.s.slice(0, 90)}${m.s.length > 90 ? "…" : ""}"`,
      );
    }
    if (missing.length > 40)
      r.add("warn", null, `… and ${missing.length - 40} more sentences without a marker`);
  }

  // Facts cross-check: anything checkable must appear in the facts file verbatim.
  if (facts) {
    for (const url of urlsOf(doc))
      if (!facts.urls.has(url)) r.add("error", null, `URL not in FACTS: ${url}`);
    for (const span of new Set(codeSpans(doc))) {
      if (!facts.text.includes(span))
        r.add("warn", null, `code span not found in FACTS: \`${span.slice(0, 60)}\``);
    }
    for (const num of new Set(numbersOf(doc))) {
      if (!facts.text.includes(num)) r.add("warn", null, `number not found in FACTS: ${num}`);
    }
  }

  // Language rules: the style file's patterns, then the counted ones.
  const pats = loadPatterns(lang);
  const proseItems = items
    .filter((it) => ["text", "list", "quote", "heading", "caption", "table"].includes(it.type))
    .concat(figureLines(doc));
  for (const it of proseItems) {
    const t = prose(it.line).replace(MARKER, "");
    for (const level of ["error", "warn"]) {
      for (const p of pats[level]) {
        const m = p.re.exec(t);
        if (m) r.add(level, it.n, `${p.label}: "${m[0].trim().slice(0, 50)}"`);
      }
    }
  }

  const sections = [];
  let current = { n: null, items: [] };
  sections.push(current);
  for (const it of items) {
    if (it.type === "heading") {
      current = { n: it.n, items: [] };
      sections.push(current);
    } else current.items.push(it);
  }

  if (lang === "en") {
    for (const sec of sections) {
      const dashes = sec.items
        .filter((it) => ["text", "list", "quote"].includes(it.type))
        .reduce((sum, it) => sum + (maskProse(it.line).match(/—/g)?.length ?? 0), 0);
      if (dashes > 1)
        r.add(
          "error",
          sec.n ?? sec.items[0]?.n,
          `${dashes} em dashes in one section (at most one)`,
        );
    }
    for (const it of proseItems) {
      const t = maskProse(it.line).replace(MARKER, "");
      if (/\S—|—\S/.test(t)) r.add("error", it.n, "unspaced em dash (write ` — `)");
      if (/\w\s--\s\w/.test(t)) r.add("warn", it.n, "double hyphen used as a dash");
      if (/!(?!\[)/.test(t.replace(/!\[[^\]]*\]\([^)]*\)/g, "")))
        r.add("error", it.n, "exclamation mark");
    }
    for (const p of paras) {
      const ss = sentences(p.text);
      if (ss.length > 4) r.add("warn", p.n, `a paragraph of ${ss.length} sentences (at most four)`);
      let shortRun = 0;
      for (const s of ss) {
        const words = maskProse(s).replace(MARKER, "").split(/\s+/).filter(Boolean).length;
        shortRun = words <= 3 ? shortRun + 1 : 0;
        if (shortRun === 3) r.add("warn", p.n, "three very short sentences in a row");
      }
    }
    for (const sec of sections) {
      const first = paragraphs({ items: sec.items })[0];
      const s = first ? sentences(first.text)[0] : undefined;
      if (s && /\?["”’)]*\s*(\{[FO]\d+\})*$/.test(s))
        r.add("warn", first.n, "a section opens with a question");
    }
    const all = paras.flatMap((p) => sentences(p.text));
    const words = all.map(
      (s) => maskProse(s).replace(MARKER, "").split(/\s+/).filter(Boolean).length,
    );
    const avg = words.length ? words.reduce((a, b) => a + b, 0) / words.length : 0;
    if (avg > 20)
      r.add("warn", null, `average sentence length ${avg.toFixed(1)} words (aim under 20)`);
  } else {
    const spacing = new RegExp(`[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}]`);
    for (const it of proseItems) {
      const t = maskProse(it.line).replace(MARKER, "").replace(/⟦\w+⟧/g, " ");
      if (/——|—/.test(t)) r.add("error", it.n, "破折号");
      if (/[！!]/.test(t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""))) r.add("error", it.n, "感叹号");
      if (/"/.test(maskProse(it.line))) r.add("error", it.n, "中文正文里的英文引号");
      const sp = spacing.exec(t.replace(/\*\*/g, ""));
      if (sp) r.add("error", it.n, `中英文或数字之间缺半角空格: "${sp[0]}"`);
      for (const m of t.matchAll(/：(?![「“『])/g)) {
        if (it.type !== "table")
          r.add(
            "warn",
            it.n,
            `冒号不是引出原话: "${t.slice(Math.max(0, m.index - 12), m.index + 2).trim()}"`,
          );
      }
      if (/（[\x20-\x7e]+）/.test(t)) r.add("warn", it.n, "括号内全为英文或数字时用半角括号");
      if (new RegExp(`\\([^)]*[${CJK}][^)]*\\)`).test(t))
        r.add("warn", it.n, "括号内有中文时用全角括号");
      if (/的[^，。；！？、]{0,6}的[^，。；！？、]{0,6}的/.test(t))
        r.add("warn", it.n, "「的」连用超过两个");
    }
    for (const p of paras) {
      const ss = sentences(p.text);
      if (ss.length > 4) r.add("warn", p.n, `一段 ${ss.length} 句（最多四句）`);
      const it = ss.filter((s) => /^它/.test(s)).length;
      if (it > 1) r.add("warn", p.n, "「它」开头的句子连用");
      const zhe = ss.filter((s) => /^这/.test(s)).length;
      if (zhe > 1) r.add("warn", p.n, `${zhe} 个句子以「这」开头`);
    }
  }
  const bolds = proseItems
    .filter((it) => it.type !== "footer")
    .reduce((sum, it) => sum + (it.line.match(/\*\*[^*]+\*\*/g)?.length ?? 0), 0);
  if (bolds > 4)
    r.add(
      "warn",
      null,
      `${bolds} bold spans (bold only UI labels and product names on first mention)`,
    );

  return { h2, imgs, used, footer, paras };
}

function pairDocs(a, b, o, r) {
  const langA = o.lang ?? langOf(a.file);
  const langB = langOf(b.file);
  if (langA && langB && langA === langB) r.add("error", null, `both files are ${langA}`);
  for (const k of ["date", "category", "pinned", "author"]) {
    if ((a.meta[k] ?? "") !== (b.meta[k] ?? "")) {
      r.add(
        "error",
        1,
        `frontmatter ${k} differs: "${a.meta[k] ?? ""}" vs "${b.meta[k] ?? ""}" in ${b.file}`,
      );
    }
  }
  const h = (d) =>
    d.items.filter((it) => it.type === "heading").map((it) => HEADING.exec(it.line)[1]);
  const ha = h(a);
  const hb = h(b);
  if (ha.join() !== hb.join())
    r.add(
      "error",
      null,
      `headings differ: ${ha.length} here, ${hb.length} in ${b.file} (or their levels differ)`,
    );
  const ia = images(a);
  const ib = images(b);
  if (ia.length !== ib.length)
    r.add("error", null, `${ia.length} images here, ${ib.length} in ${b.file}`);
  ia.forEach((img, i) => {
    const other = ib[i];
    if (other && (img.stem !== other.stem || img.ext !== other.ext)) {
      r.add(
        "error",
        img.n,
        `image ${i + 1} is ${img.stem}.${img.ext} here and ${other.stem}.${other.ext} in ${b.file}`,
      );
    }
  });
  const fa = a.figures.map((f) => f.id);
  const fb = b.figures.map((f) => f.id);
  if (fa.join() !== fb.join())
    r.add(
      "error",
      null,
      `figure blocks differ: [${fa.join(", ")}] here, [${fb.join(", ")}] in ${b.file}`,
    );
  for (const fig of a.figures) {
    const other = b.figures.find((f) => f.id === fig.id);
    if (!other) continue;
    if (fig.text.length !== other.text.length) {
      r.add(
        "error",
        fig.n,
        `figure ${fig.id}: ${fig.text.length} strings here, ${other.text.length} in ${b.file}`,
      );
    }
    const wa = fig.text.map((t) => t.where ?? "").join();
    const wb = other.text.map((t) => t.where ?? "").join();
    if (fig.text.length === other.text.length && wa !== wb)
      r.add("warn", fig.n, `figure ${fig.id}: the <where> words differ from ${b.file}`);
    if (!!fig.title !== !!other.title)
      r.add("error", fig.n, `figure ${fig.id}: a title in only one of the two files`);
  }
  const caps = (d) => d.items.filter((it) => it.type === "caption").length;
  if (caps(a) !== caps(b))
    r.add("error", null, `${caps(a)} captions here, ${caps(b)} in ${b.file}`);
  const note = (d) => !!versionNoteOf(d);
  if (note(a) !== note(b))
    r.add("error", null, `version note present in only one of the two files`);
  const foot = (d) => d.items.some((it) => it.type === "footer");
  if (foot(a) !== foot(b))
    r.add("error", null, `**Sources** footer present in only one of the two files`);

  const compare = (what, xa, xb, level) => {
    const { onlyA, onlyB } = multisetDiff(xa, xb);
    if (onlyA.length || onlyB.length) {
      const show = (xs) =>
        xs
          .slice(0, 8)
          .map((x) => JSON.stringify(x.length > 60 ? `${x.slice(0, 60)}…` : x))
          .join(", ");
      r.add(
        level,
        null,
        `${what} differ: only here [${show(onlyA)}]; only in ${path.basename(b.file)} [${show(onlyB)}]`,
      );
    }
  };
  compare("code spans", codeSpans(a), codeSpans(b), "error");
  compare("URLs", urlsOf(a), urlsOf(b), "error");
  const markers = (d) =>
    d.items.flatMap((it) => (it.type === "code" ? [] : (it.line.match(MARKER) ?? [])));
  compare("fact markers", markers(a), markers(b), "error");
  compare("numbers", numbersOf(a), numbersOf(b), "warn");
}

function summary(doc, lang, info) {
  const fences = doc.items.filter((it) => it.type === "fence").length;
  const captions = doc.items.filter((it) => it.type === "caption").length;
  const f = [...info.used].filter((id) => id.startsWith("F")).length;
  const op = info.used.size - f;
  process.stdout.write(
    `${doc.file} (${lang}): ${info.h2.length} sections · ${doc.figures.length} figure blocks · ${info.imgs.length} images · ${captions} captions · ` +
      `${fences} code fences · footer ${info.footer ? "yes" : "no"} · ` +
      `${info.used.size ? `${info.used.size} distinct markers (F ${f}, O ${op})` : "no markers"}\n`,
  );
}

function runCheck(o) {
  if (!o.in) fail("check needs --in <file>");
  const doc = parseDoc(o.in);
  const lang = checkLang(
    o.lang ?? langOf(o.in) ?? "",
    `${o.in}: no .en./.zh. in the name; pass --lang`,
  );
  const facts = o.facts ? loadFacts(o.facts) : null;
  const r = reporter(o.in);
  const info = checkDoc(doc, lang, o, r, facts);
  if (facts && info.used.size) {
    const unused = [...facts.ids].filter((id) => id.startsWith("F") && !info.used.has(id));
    if (unused.length) r.add("warn", null, `facts not cited: ${unused.join(", ")}`);
  }
  const counterpart = o.pair ?? o.with;
  if (counterpart) pairDocs(doc, parseDoc(counterpart), o, r);
  summary(doc, lang, info);
  const errors = r.print();
  const warns = r.hits.length - errors;
  process.stdout.write(
    `${errors} error${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}\n`,
  );
  process.exit(errors ? 1 : 0);
}

function runPair(o) {
  const counterpart = o.pair ?? o.with;
  if (!o.in || !counterpart) fail("pair needs --in <file> --pair <counterpart>");
  const r = reporter(o.in);
  pairDocs(parseDoc(o.in), parseDoc(counterpart), o, r);
  const errors = r.print();
  process.stdout.write(
    `pair ${o.in} ↔ ${counterpart}: ${errors} error${errors === 1 ? "" : "s"}, ${r.hits.length - errors} warning${r.hits.length - errors === 1 ? "" : "s"}\n`,
  );
  process.exit(errors ? 1 : 0);
}

/** The published form of a figure block: the image line and its italic caption. */
function figureImage(fig, lang, assets) {
  let ext = "png";
  if (assets && !existsSync(path.join(assets, `${fig.id}-${lang}.png`))) {
    if (existsSync(path.join(assets, `${fig.id}-${lang}.jpg`))) ext = "jpg";
    else process.stderr.write(`note: ${fig.id}-${lang}.png is not under --assets yet\n`);
  }
  return [`![${fig.alt ?? ""}](/blog-assets/${fig.id}-${lang}.${ext})`, `_${fig.caption ?? ""}_`];
}

function runStrip(o) {
  if (!o.in || !o.out) fail("strip needs --in <file> --out <file>");
  const doc = parseDoc(o.in);
  const lang = o.lang ?? langOf(o.in);
  if (doc.figures.length) {
    checkLang(
      lang ?? "",
      `${o.in}: no .en./.zh. in the name, and figure blocks need one; pass --lang`,
    );
    const bad = doc.figures.filter((f) => !f.id || !f.closed || !f.alt || !f.caption);
    if (bad.length)
      fail(
        `figure blocks without id, alt, caption or a closing fence at line ${bad.map((f) => f.n).join(", ")}; run check`,
        1,
      );
  }
  const kept = [];
  const notes = [];
  let inComment = false;
  let fence = null;
  let skipUntil = 0;
  const head = doc.metaRaw === null ? "" : `---\n${doc.metaRaw}\n---\n`;
  const lines = doc.body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = doc.bodyLine + i;
    if (n <= skipUntil) continue;
    const fig = doc.figures.find((f) => f.n === n);
    if (fig) {
      kept.push(...figureImage(fig, lang, o.assets));
      skipUntil = fig.end;
      continue;
    }
    const fenceMark = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      kept.push(line);
      if (fenceMark && fenceMark[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      kept.push(line);
      continue;
    }
    if (inComment || /^\s*<!--/.test(line)) {
      notes.push(line);
      inComment = !line.includes("-->");
      continue;
    }
    kept.push(line.replace(/^(?:\{[FO]\d+\})+[ \t]*/, "").replace(/[ \t]*\{[FO]\d+\}/g, ""));
  }
  let body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  body = `${head}\n${body}\n`;
  const left = body.match(/\{[FO]\d+\}|\{\{[A-Z_]+\}\}/g);
  if (left) fail(`markers or slots survived the strip: ${[...new Set(left)].join(", ")}`, 1);
  writeFileSync(o.out, body);
  for (const n of notes) process.stderr.write(`removed note: ${n.trim()}\n`);
  process.stderr.write(`wrote ${o.out}\n`);
}

// ---------------------------------------------------------------------------

const { step, opts } = parseArgs(process.argv.slice(2));
if (!step || step === "--help" || opts.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(step ? 0 : 2);
}
if (API_STEPS.includes(step)) {
  const messages = buildMessages(step, opts);
  if (opts["dry-run"]) {
    const temperature = opts.temperature ?? (step === "outline" ? 0.5 : 0.3);
    process.stdout.write(
      `== ${step} (${messages.lang}) · model ${opts.model ?? DEFAULT_MODEL} · temperature ${temperature} · max_tokens ${opts["max-tokens"] ?? 32000} ==\n` +
        `== system (${messages.system.length} chars) ==\n${messages.system}\n\n` +
        `== user (${messages.user.length} chars) ==\n${messages.user}\n`,
    );
    process.exit(0);
  }
  if (!opts.out) fail(`${step} needs --out <file> (or --dry-run)`);
  await callApi(step, opts, messages);
} else if (LOCAL_STEPS.includes(step)) {
  if (step === "check") runCheck(opts);
  else if (step === "pair") runPair(opts);
  else runStrip(opts);
} else {
  fail(`unknown step "${step}"; steps: ${[...API_STEPS, ...LOCAL_STEPS].join(", ")}`);
}

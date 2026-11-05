#!/usr/bin/env node
/**
 * Prose for penguin.ooo (blog posts, docs pages, landing copy): every reader-facing word comes
 * from a model on the TokenDance gateway, and this script is the only way it gets there. API steps
 * assemble one prompt pair from ../prompts and ../reference, send it, and save the answer plus the
 * raw response; local steps check, strip and pair-check the drafts without touching the network.
 *
 *   node prose.mjs <step> [options]
 *
 *   API steps:   outline | section | write | translate | polish | fix | trim | emphasize |
 *                transition | review
 *   local steps: plan | assemble | route | check | strip | unstrip | pair | selftest
 *
 * A post is planned once (outline, then plan validates and freezes it), written in one call as a
 * whole, reviewed, fixed, cut and translated as a whole, and published by strip, which turns the
 * fact markers into numbered footnotes. Section mode (one section per call, assembled byte for
 * byte) stays for long posts and docs pages. A fix or trim answer that breaks what the step
 * may not change is set aside as <out>.rejected.md, never written as the next version.
 *
 * Run with --help for the options. The key comes from TOKENDANCE_API_KEY or the file named by
 * TOKENDANCE_KEY_FILE, never from an argument, so it stays out of shell history; nothing here
 * prints it, and the saved raw JSON holds the request body and the response, not the headers.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, "..");
const PROMPTS = path.join(SKILL, "prompts");
const REFERENCE = path.join(SKILL, "reference");

const ENDPOINT = "https://tokendance.space/gateway/v1/chat/completions";
const DEFAULT_MODEL = "seed-2.1-pro";
const API_STEPS = [
  "outline",
  "section",
  "write",
  "translate",
  "polish",
  "fix",
  "trim",
  "emphasize",
  "transition",
  "review",
];
const LOCAL_STEPS = ["plan", "assemble", "route", "check", "strip", "unstrip", "pair", "selftest"];
const LANG_NAME = { en: "English", zh: "Chinese" };
const BLOG_CATEGORIES = ["news", "practice", "perspectives", "changelog"];
const CATEGORY_NAME = {
  news: "news",
  practice: "practice",
  perspectives: "perspective",
  changelog: "release-notes",
};
const NOUN = { post: "post", docs: "page", landing: "text" };
const FRONTMATTER_KEYS = {
  post: ["title", "date", "category", "excerpt", "author", "pinned"],
  docs: ["title", "description"],
};
const TEMPERATURE = { outline: 0.5, review: 0.2 };
/** 429 is the key's concurrency cap; 5xx and dropped connections are the gateway's. */
const MAX_ATTEMPTS = 6;
const BACKOFF_S = [10, 20, 40, 60, 90];
/** trim aims this far under the cap: the model counts loosely, and an answer over the cap is rejected. */
const TRIM_AIM = 0.95;
/** A whole-draft trim that leaves a section below this share of its target cut too much: refused. */
const TRIM_FLOOR = 0.9;

const HELP = `usage: node prose.mjs <step> [options]

The flow for a post (one language; the second follows by one translate call):
  outline → plan --freeze → write (the whole post) → check --plan-rows advisory → trim if over
  → review + truth review → fix (≤ 2 rounds) → transition → review → translate → …
  → transition → review → emphasize → pair → strip → check
Section mode (long posts, docs written task by task): section 0 … N, each followed by
  check --section → assemble → review → route → fix per section → assemble → … (SKILL.md section 4)

API steps (one gateway call each; --dry-run prints the messages instead and saves nothing):
  outline    --brief <f> --facts <f> --figure-count <text> [--figures <manifest>]
             [--word-budget <n|a-b>] [--section-cap <n>] [--research <f>]...
             [--feedback <text|@f> --previous <f>] [--meme <f>] [--title-rule <text|@f>]
               the answer's # Plan table is validated against the profile's budgets, the
               manifest and FACTS; a failure writes outline-feedback.auto.md beside --out
  write      --outline <f> --facts <f> [--figures <manifest>] [--reuse-figures <frozen draft>]
             [--feedback <text|@f> --previous <f>] [--notes <f>] [--title <t>]
             [--version-note <t>] [--date YYYY-MM-DD] [--meme <f>] [--title-rule <text|@f>]
               a whole post, docs page or set of landing strings in one call; a post needs
               --figures, and --out defaults to the next draft.<lang>.vN.md beside --outline.
               An answer with another version note or title than given, a notes keep: string
               missing or avoid: string present, a footnote, or bold beyond the TL;DR line goes
               to <out>.rejected.md (exit 1); the report lists sizes, figures and the next step
  section    --outline <outline.final.md> --section <n> --facts <f> [--figures <manifest>]
             [--sections-dir <dir>] [--out <dir>/s<n>.<lang>.v<k>.md] [--reuse-figures <frozen draft>]
             [--feedback <text|@f> [--previous <f>]] [--facts-all] [--title-rule …] [--meme <f>]
             [--version-note <t>] [--date YYYY-MM-DD]
               section mode: one section from the frozen plan; --out defaults to the next version
  translate  --in <f> --facts <f> --to en|zh [--title <t>] [--notes <f>] [--title-rule <text|@f>]
             [--reuse-figures <frozen target draft> --reuse-source <frozen source draft>]
             section mode (an s<n>.<lang>.v<k>.md input, or --sections-dir): --outline <f>
  polish     --in <f>                       section mode: neighbours read-only
  fix        --in <f> --findings <f> --facts <f> [--outline <f>] [--notes <f>]   section mode
               returns the section only; an answer with a marker neither the input nor the
               findings name, a figure block changed that no finding names, or on a whole post a
               heading, title or section count changed that no finding names, goes to
               <out>.rejected.md (exit 1)
  trim       --in <draft.<lang>.vN.md | s<n>.<lang>.v<k>.md> [--outline <f> | --cap <n>]
               cuts deletions and shorter wording only. A whole draft: each section over its
               profile cap, aimed at 95 % of that cap (never at its plan row), and, while the page
               is over its cap, a proportional share of the rest from every other section; an
               answer that changes another section, cuts a named section below 90 % of its
               target, or loses a number the text stated, goes to <out>.rejected.md; a figure
               block the answer changed is put back first. A section: an answer
               still over the cap, or with a marker, footnote, figure block, heading, frontmatter
               or version note changed, goes there too (exit 1; retry once, then the author).
               --out defaults to the next version. fix, polish and translate refuse a changed
               version note the same way. In section mode every call aims at the lowest of the
               planned size, what the page has left and the profile's cap; the other sections
               count as --page <assembled draft> holds them, else as their newest files
  emphasize  --in <draft.<lang>.vN.md> [--mirror <the other language's emphasized draft>]
             [--notes <f>]   the notes say which sentence to mark where the author has a view
               marks one key sentence per section (and in the lead) with ** and changes nothing
               else; an answer that differs once ** are removed, or has a section with no span or
               two, or a span too long, in the wrong place or over part of a sentence, goes to
               <out>.rejected.md (exit 1).
               --out defaults to the next draft version
  transition --in <draft.<lang>.vN.md> [--findings <review findings>] [--notes <f>]
               mends the joins: for each ## heading, the first sentence of the paragraph after it
               and, when the join needs it, the last sentence of the paragraph before it; nothing
               else. An answer that changes any other block or sentence, a marker of a rewritten
               sentence, a heading, the TL;DR, a figure block or the frontmatter goes to
               <out>.rejected.md (exit 1). The review's transition and signpost findings are
               passed on. Prints every join, before → after; then review the result again.
               --out defaults to the next draft version
  review     --in <f> [--facts <f>] [--notes <f>] [--tells]   numbered findings in the form fix
             reads; --out defaults to findings.<lang>.vN.api.md (findings.s<n>.<lang>.vK.api.md
             for a section). On a whole post it scores every join, and its closing
             "transitions: n of m" line goes to <out>.flow.txt

  common:    --profile <name|f>   blog-perspectives | blog-practice | blog-news | blog-changelog |
                                  docs | landing, or a profile file; loads reference/profile-<name>.md
             --category <c>       shorthand: perspectives -> blog-perspectives, docs -> docs, ...
                                  Default: the input's frontmatter category (a docs page is
                                  recognised by its description), else blog-perspectives
             --out <f>            the completion (required unless --dry-run or defaulted); the raw
                                  JSON goes to <out>.raw.json, or <raw-dir>/<folder>-<step>-<out
                                  name>.raw.json, or --raw <f>; an existing raw file is never overwritten
             --model <id>         default ${DEFAULT_MODEL}
             --temperature <n>    default 0.3 (outline 0.5, review 0.2)
             --max-tokens <n>     default 32000 (reasoning counts against it)
             --lang en|zh         language produced; default from the file name (.en. / .zh.),
                                  else en (translate: --to)
             --date YYYY-MM-DD    frontmatter date; default the input's date, else today
             --version-note <t>   the verbatim note line (without "> "), or "none"; polish/fix
                                  default to the note already in the input
             --timeout <s>        per attempt, default 1800

local steps:
  plan       --in <outline> [--profile …] [--facts <f>] [--figures <manifest>] [--lang en|zh]
             [--freeze]   validates the # Plan table; --freeze copies it to outline.final.md
  assemble   --sections-dir <dir> --lang en|zh --out <draft.<lang>.vN.md> [--outline <f>]
             [--pin s<n>=v<k>]...   joins the latest (or pinned) s0 … sN, byte for byte
  route      --findings <findings.<lang>.vN.md> --sections-dir <dir>
               splits findings into findings.s<n>.<lang>.vN.md by the section quoting each
               passage; the rest go to findings.unrouted.<lang>.vN.md
  check      --in <f> [--profile <name|f>] [--facts <f>] [--outline <f>] [--section <n>] [--page <f>]
             [--plan-rows hard|advisory]
             [--figures <manifest>] [--svg <dir>] [--draft <f>] [--slug <slug>] [--pair <f>]
             [--assets <dir>] [--version-note <t>] [--lang en|zh]
               budgets are hard: a section above min(plan × 1.1, profile cap) is an error;
               --plan-rows advisory (a post written whole): above the plan row a warning, above
               the profile cap an error
               --section (or an s<n>… file): one section — its shape, the figures its row owns,
                 and the page total with the other sections' latest versions (warned when over)
               --figures: every manifest stem has a figure block, in order, and no others
               --svg: on a draft, <dir>/<id>.<lang>.html must exist for every drawn figure block
                 and match it exactly (title = alt, figcaption = caption, fig-steps = text,
                 drawn text leaves = text, ids <slug>-<id>-<lang>, no blank line)
               --draft: on a stripped post, the same assertions for its inline figures against
                 the draft's blocks; footnotes are checked against ## SOURCES with --facts
  pair       --in <f> --pair <f>   per section: markers, citations, figures, code, URLs, numbers
  strip      --in <f> --out <f> [--facts <f> [--numbering-from <other language's post>]]
             [--figures-dir <dir>] [--assets <dir>]
               removes the model's notes; with --facts a paragraph's first marker group with a
               public source not cited yet becomes [^n] after its sentence (each source once per
               post, one per paragraph, numbered by first use or by the other post) and the
               [^n]: [title](url) list closes the post; a drawn figure block becomes
               <dir>/<id>.<lang>.html on one line, a screenshot block an image line + caption
  unstrip    --in <published post> --out-dir <dir> [--pair <the other language's recovered draft>
             --facts <its seed or facts file>] [--slug <slug>]
               a published post back into a draft: <dir>/recovered.<lang>.md (each inline figure
               and screenshot a figure block, each [^n] a fact marker), <dir>/figures/<id>.<lang>.html
               (each inline figure as published, for check --svg and strip --figures-dir) and
               <dir>/facts.<lang>.seed.md (## SOURCES from the reference list, ## FACTS one line per
               citation). Guard: every figure matches its block, and strip of the draft with the
               seed gives back every figure and image line byte for byte and the prose once
               citations are removed; else exit 1. --pair aligns the second language with the
               first: the same S ids, and each citation the fact id the paired draft gives that
               source in the same section
  selftest                        runs the local steps on built-in fixtures; exits 1 on a regression`;

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
  "profile",
  "category",
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
  "draft",
  "slug",
  "figures-dir",
  "section",
  "sections-dir",
  "reuse-figures",
  "reuse-source",
  "pin",
  "numbering-from",
  "section-cap",
  "cap",
  "mirror",
  "page",
  "title",
  "notes",
  "plan-rows",
  "out-dir",
]);
const FLAGS = new Set(["dry-run", "help", "tells", "facts-all", "freeze"]);
const REPEATABLE = new Set(["research", "pin"]);

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
  WORD_CAP: "--word-budget (or the profile's words / zh-chars setting)",
  SECTION_CAP: "--section-cap (or the profile's section-words / zh-section-chars setting)",
  LEAD_RANGE: "the profile's lead-words / zh-lead-chars setting",
  PREVIOUS_SECTION: "--previous (the attempt the feedback is about)",
  PREVIOUS_OUTLINE: "--previous (the outline the feedback is about)",
  MEME_BRIEF: "--meme",
};

function fail(message, code = 2) {
  process.stderr.write(`prose: ${message}\n`);
  process.exit(code);
}

function note(message) {
  process.stderr.write(`note: ${message}\n`);
}

function parseArgs(argv) {
  const [step, ...rest] = argv;
  const opts = { research: [], pin: [] };
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
// Profiles: what kind of text is being written
// ---------------------------------------------------------------------------

function knownProfileName(name) {
  return name === "docs" || name === "landing" || /^blog-[a-z]+$/.test(name);
}

/**
 * The profile a step works under. `--profile` names one (or a file); `--category` is shorthand;
 * otherwise the input's frontmatter decides, and a text with no clue gets blog-perspectives.
 */
function resolveProfile(o, meta = {}, { announce = true } = {}) {
  const isFile = !!o.profile && (o.profile.includes("/") || o.profile.endsWith(".md"));
  let name = isFile ? undefined : o.profile;
  if (!name && o.category) {
    name = o.category === "docs" || o.category === "landing" ? o.category : `blog-${o.category}`;
  }
  // A profile file names its profile: `profile-<name>.md`, `profile-<category>.md`, or the
  // `--profile <name>` its header says it is loaded for.
  if (!name && isFile) {
    const m = /^profile-(.+)\.md$/.exec(path.basename(o.profile));
    if (m && knownProfileName(m[1])) name = m[1];
    else if (m && BLOG_CATEGORIES.includes(m[1])) name = `blog-${m[1]}`;
    else if (existsSync(o.profile)) {
      const said = /--profile ([a-z]+(?:-[a-z]+)?)\b/.exec(read(o.profile))?.[1];
      if (said && knownProfileName(said)) name = said;
    }
  }
  if (!name && meta.category) name = `blog-${meta.category}`;
  if (!name && meta.description !== undefined) name = "docs";
  if (!name) {
    name = "blog-perspectives";
    if (announce && !isFile)
      note("profile blog-perspectives (the default; pass --profile to choose)");
  }
  if (announce && isFile) note(`profile ${name} from ${o.profile}`);
  if (!knownProfileName(name)) fail(`profile "${name}": use blog-<category>, docs or landing`);
  const kind = name === "docs" || name === "landing" ? name : "post";
  const category = kind === "post" ? name.slice("blog-".length) : kind;
  if (kind === "post" && !BLOG_CATEGORIES.includes(category)) {
    fail(`blog category "${category}" is not one of ${BLOG_CATEGORIES.join(", ")}`);
  }
  const file = isFile ? o.profile : path.join(REFERENCE, `profile-${name}.md`);
  return { name, kind, category, file };
}

function profileFile(prof) {
  if (!existsSync(prof.file)) {
    fail(`no profile file for "${prof.name}" (${prof.file}); pass --profile <file>`);
  }
  return read(prof.file);
}

/** A `prompt <lang>` block replaces the generic `prompt` block for that language. */
function profilePrompt(prof, lang) {
  const text = profileFile(prof);
  const m =
    new RegExp(`<!-- prompt ${lang} -->\\n([\\s\\S]*?)\\n<!-- /prompt -->`).exec(text) ??
    /<!-- prompt -->\n([\s\S]*?)\n<!-- \/prompt -->/.exec(text);
  if (!m) fail(`${prof.file} has no <!-- prompt --> … <!-- /prompt --> block`);
  return m[1].trim();
}

/** `## Check settings` as `- key: value` lines; a profile without them sets no structure rules. */
function profileSettings(prof) {
  if (!existsSync(prof.file)) return {};
  const section = read(prof.file).split(/^## Check settings$/m)[1] ?? "";
  const out = {};
  for (const line of section.split("\n")) {
    if (/^## /.test(line)) break;
    const m = /^- ([a-z-]+):\s*(.+)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
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
 * Fill a template. `params` are prompt text (styles, profiles, the contract, fragments, option
 * values) and are expanded repeatedly, since one may name another; `content` is file content
 * (facts, drafts, outlines) and goes in last, in one pass, so a `{{…}}` inside a draft is never
 * read as a slot.
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

/**
 * What every step that sees the profile shares: the piece, the profile text, the contract. With
 * `budgets`, a whole-piece contract also states the caps check holds the piece to.
 */
function profileParams(F, prof, lang, { contract, markers, date, versionNote, budgets } = {}) {
  const params = {
    PIECE: F[`piece-${prof.kind}`],
    NOUN: NOUN[prof.kind],
    CATEGORY: prof.category,
    CATEGORY_NAME: CATEGORY_NAME[prof.category] ?? prof.category,
    PROFILE: F["profile-wrapper"],
    PROFILE_TEXT: profilePrompt(prof, lang),
    LANG: lang,
    LANG_NAME: LANG_NAME[lang],
  };
  if (contract) {
    params.CONTRACT = read(path.join(PROMPTS, `contract-${prof.kind}.md`)).trim();
    params.MARKER_RULE = F[`markers-${markers}`];
    params.DATE = date;
    // Without a note the lead's shape says nothing about one: an instruction that names the note
    // ("No version note.") was copied into a post as a line of text.
    if (versionNote && versionNote !== "none") {
      params.VERSION_NOTE_RULE = F["version-note-rule"];
      params.VERSION_NOTE_SENTENCE = ` ${F["version-note-rule"]}`;
      params.VERSION_NOTE = versionNote;
    } else {
      params.VERSION_NOTE_RULE = F["no-version-note"];
      params.VERSION_NOTE_SENTENCE = "";
    }
    params.BUDGET_RULE = "";
    if (budgets?.total) {
      // A part without a cap of its own is bounded by the whole.
      const capOf = (range) => `${(range ?? budgets.total).cap} ${budgets.unitName}`;
      Object.assign(params, countRuleParams(F, lang));
      params.BUDGET_RULE = `\n- ${F["budget-whole"]}`;
      params.TOTAL_CAP = capOf(budgets.total);
      params.LEAD_CAP = capOf(budgets.lead);
      params.SECTION_CAP_TEXT = capOf(budgets.section);
      params.TLDR_NOTE = budgets.tldr ? ` ${F["tldr-budget"]}` : "";
      if (budgets.tldr) {
        params.TLDR_RANGE = `${budgets.tldr.floor}–${budgets.tldr.cap} ${budgets.unitName}`;
      }
    }
  }
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

/** `draft.en.v3.md` → `findings.en.v3.api.md` beside it; any other name needs --out. */
function defaultReviewOut(input) {
  // Only for a scratch draft or section: findings beside a file in the repo would land in its tree.
  const m = /^draft\.(en|zh)\.(v\d+)\.md$/.exec(path.basename(input));
  if (m) return path.join(path.dirname(input), `findings.${m[1]}.${m[2]}.api.md`);
  const s = sectionOfFile(input);
  return s
    ? path.join(path.dirname(input), `findings.s${s.n}.${s.lang}.v${s.v}.api.md`)
    : undefined;
}

// ---------------------------------------------------------------------------
// Plans, sections and budgets
// ---------------------------------------------------------------------------

const SECTION_FILE = /^s(\d+)\.(en|zh)\.v(\d+)\.md$/;
const UNIT_NAME = { words: "English words", chars: "Chinese characters" };
/** Chinese characters per English word, measured on translated drafts; used to size a translation. */
const ZH_PER_EN = 2.4;
/** A translated section above this many characters per English word is flagged by `pair`. */
const ZH_PER_EN_MAX = 2.6;

/** The section number, language and version a `s<n>.<lang>.v<k>.md` file name carries. */
function sectionOfFile(file) {
  const m = SECTION_FILE.exec(path.basename(file ?? ""));
  return m ? { n: Number(m[1]), lang: m[2], v: Number(m[3]) } : undefined;
}

/** Every version of every section of one language in a directory: n → [{ v, file }], ascending. */
function sectionFiles(dir, lang) {
  const out = new Map();
  if (!dir || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const s = sectionOfFile(name);
    if (!s || s.lang !== lang) continue;
    if (!out.has(s.n)) out.set(s.n, []);
    out.get(s.n).push({ v: s.v, file: path.join(dir, name) });
  }
  for (const list of out.values()) list.sort((a, b) => a.v - b.v);
  return out;
}

function latestSection(dir, n, lang) {
  const list = sectionFiles(dir, lang).get(n);
  return list ? list[list.length - 1] : undefined;
}

/** The next free `s<n>.<lang>.v<k>.md` path in a directory. */
function nextSectionFile(dir, n, lang) {
  const last = latestSection(dir, n, lang);
  return path.join(dir, `s${n}.${lang}.v${last ? last.v + 1 : 1}.md`);
}

/** The lines that count as body text: no frontmatter, version note, figures, headings, notes or references. */
function bodyLines(text) {
  const { body } = splitFrontmatter(text);
  const out = [];
  let fence = null;
  let figure = false;
  let comment = false;
  let first = true;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (figure) {
      if (/^```\s*$/.test(t)) figure = false;
      continue;
    }
    if (fence) {
      if (t.startsWith(fence)) fence = null;
      else out.push(line);
      continue;
    }
    if (comment) {
      if (t.includes("-->")) comment = false;
      continue;
    }
    if (FIGURE_OPEN.test(t)) {
      figure = true;
      continue;
    }
    const fenceMark = /^(```+|~~~+)/.exec(t);
    if (fenceMark) {
      fence = fenceMark[1];
      continue;
    }
    if (t.startsWith("<!--")) {
      comment = !t.includes("-->");
      continue;
    }
    if (first && t) {
      first = false;
      if (VERSION_NOTE_LINE.test(t)) continue;
    }
    if (
      HEADING.test(t) ||
      HTML_FIGURE.test(t) ||
      FOOTER.test(t) ||
      IMAGE_LINE.test(t) ||
      CAPTION.test(t) ||
      FOOTNOTE_DEF.test(t) ||
      /^([-*_])(\s*\1){2,}$/.test(t)
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Body size: English words (whitespace tokens holding a letter or digit) or Chinese characters
 * (non-whitespace after the Markdown syntax is removed). One counter for check, assemble and the
 * section step, so a budget means the same number everywhere. The `count-rule-<lang>` fragments
 * tell the model this rule in words, with an example this function counts; change them together.
 */
function countBody(text, lang) {
  let t = bodyLines(text)
    .join("\n")
    .replace(MARKER, " ")
    .replace(/\[\^\d+\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  if (lang === "zh") {
    t = t
      .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/[*_`|#]/g, "");
    return t.replace(/\s+/g, "").length;
  }
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A text cut at its `## ` headings (outside fences); section 0 is what precedes the first. */
function splitSections(text) {
  const { body, bodyLine } = splitFrontmatter(text);
  const sections = [{ n: 0, heading: null, line: bodyLine, lines: [] }];
  let fence = null;
  body.split("\n").forEach((line, i) => {
    const fenceMark = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (fenceMark && fenceMark[1].startsWith(fence)) fence = null;
    } else if (fenceMark) {
      fence = fenceMark[1];
    } else if (/^## /.test(line)) {
      sections.push({
        n: sections.length,
        heading: line.slice(3).trim(),
        line: bodyLine + i,
        lines: [],
      });
    }
    sections[sections.length - 1].lines.push(line);
  });
  return sections.map((s) => ({ ...s, text: s.lines.join("\n") }));
}

/** The raw text of every figure block in a text, by id (from the ```figure line to its close). */
function figureBlockTexts(text) {
  const out = new Map();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = FIGURE_OPEN.exec(lines[i].trim());
    if (!open) continue;
    const id = /\bid\s*=\s*"?([^\s"`]+)"?/.exec(open[1])?.[1];
    let j = i + 1;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++;
    if (id) out.set(id, lines.slice(i, j + 1).join("\n"));
    i = j;
  }
  return out;
}

function rangeOf(value) {
  const text = String(value ?? "");
  const m = /(\d+)\s*[-–]\s*(\d+)/.exec(text);
  if (m) return { floor: Number(m[1]), cap: Number(m[2]) };
  const one = /^\s*(\d+)\s*$/.exec(text);
  return one ? { floor: 0, cap: Number(one[1]) } : undefined;
}

/** The profile's budgets for one language, with --word-budget and --section-cap applied. */
function budgetsOf(prof, lang, o = {}) {
  const s = profileSettings(prof);
  const zh = lang === "zh";
  const b = {
    unit: zh ? "chars" : "words",
    unitName: UNIT_NAME[zh ? "chars" : "words"],
    total: rangeOf(s[zh ? "zh-chars" : "words"]),
    lead: rangeOf(s[zh ? "zh-lead-chars" : "lead-words"]),
    section: rangeOf(s[zh ? "zh-section-chars" : "section-words"]),
    sections: rangeOf(s.sections),
    tldr: s.tldr === "yes" ? rangeOf(s[zh ? "zh-tldr-chars" : "tldr-words"]) : undefined,
    // `ui-labels: quoted` reserves bold for the emphasis: a UI label is written in quotes.
    quotedLabels: s["ui-labels"] === "quoted",
    // One marked key sentence per section, at most this long; set by `emphasis: yes`.
    emphasis:
      s.emphasis === "yes"
        ? { cap: Number(s[zh ? "zh-emphasis-chars" : "emphasis-words"]) || undefined }
        : undefined,
  };
  if (o["word-budget"] !== undefined && rangeOf(o["word-budget"]))
    b.total = rangeOf(o["word-budget"]);
  if (o["section-cap"] !== undefined) {
    b.section = { floor: b.section?.floor ?? 0, cap: Number(o["section-cap"]) };
  }
  return b;
}

/**
 * Section 0 as the lead and its TL;DR: the `**TL;DR**` line and the list under it belong to the
 * TL;DR, which has its own budget; everything else in section 0 is the lead the plan's row 0 sizes.
 */
function splitTldr(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => TLDR.test(l.trim()));
  if (at === -1) return { lead: text, tldr: undefined };
  let end = at + 1;
  while (end < lines.length && (lines[end].trim() === "" || LIST_ITEM.test(lines[end]))) end++;
  return {
    lead: [...lines.slice(0, at), ...lines.slice(end)].join("\n"),
    tldr: lines.slice(at + 1, end).join("\n"),
  };
}

/** Section 0's sizes: the lead and, when there is one, the TL;DR, counted apart. */
function leadCounts(text, lang) {
  const { lead, tldr } = splitTldr(text);
  return {
    lead: countBody(lead, lang),
    tldr: tldr === undefined ? undefined : countBody(tldr, lang),
  };
}

/** A section's size as check judges it: the lead without its TL;DR, any other section whole. */
function sectionSize(text, n, lang) {
  return n === 0 ? leadCounts(text, lang).lead : countBody(text, lang);
}

/** A row's hard limit: the smaller of the profile cap and the plan's number plus ten percent. */
function rowCap(budgets, n, planned) {
  const limit = n === 0 ? budgets.lead : budgets.section;
  const caps = [limit?.cap, planned > 0 ? Math.round(planned * 1.1) : undefined].filter(
    (x) => x !== undefined,
  );
  return caps.length ? Math.min(...caps) : undefined;
}

/** A row's planned size in this language: its number, converted when the plan counts the other unit. */
function plannedSize(row, outline, budgets) {
  if (!row || !(row.budget > 0)) return undefined;
  if (outline.unit === budgets.unit) return row.budget;
  return Math.round(budgets.unit === "chars" ? row.budget * ZH_PER_EN : row.budget / ZH_PER_EN);
}

/** A section's share of the page total as check sums it: the lead with its TL;DR, any other whole. */
function pageShare(text, n, lang) {
  if (n !== 0) return countBody(text, lang);
  const { lead, tldr } = leadCounts(text, lang);
  return lead + (tldr ?? 0);
}

/**
 * The rest of the page around section n: each other section as the assembled draft holds it
 * (`--page`), or else its newest version in the directory, or its planned size while it is
 * unwritten. A draft names the versions actually in the page: a newer file beside it may be one
 * the author set aside and pinned an older version over.
 */
function pageAround(dir, lang, n, outline, budgets, pageFile) {
  const drafted = pageFile ? splitSections(read(pageFile, "--page")) : undefined;
  const files = drafted ? new Map() : sectionFiles(dir, lang);
  const ns = new Set([
    ...files.keys(),
    ...(drafted ?? []).map((x) => x.n),
    ...(outline?.rows ?? []).map((r) => r.n),
  ]);
  let others = 0;
  const planned = [];
  const source = pageFile ? path.basename(pageFile) : "the newest section files";
  for (const k of [...ns].sort((a, b) => a - b)) {
    if (k === n || Number.isNaN(k)) continue;
    if (drafted?.[k]) {
      others += pageShare(drafted[k].text, k, lang);
      continue;
    }
    const list = files.get(k);
    if (list) {
      others += pageShare(read(list[list.length - 1].file), k, lang);
      continue;
    }
    const size = plannedSize(
      outline?.rows.find((r) => r.n === k),
      outline,
      budgets,
    );
    if (size !== undefined) {
      others += size;
      planned.push(k);
    }
  }
  return { others, planned, source };
}

/** The page total with `text` as section n, against the page cap; undefined without a cap. */
function pageReport(dir, lang, n, text, outline, budgets, pageFile) {
  if (!budgets.total) return undefined;
  const { others, planned, source } = pageAround(dir, lang, n, outline, budgets, pageFile);
  const total = others + pageShare(text, n, lang);
  const cap = budgets.total.cap;
  const rest = planned.length ? ` (s${planned.join(", s")} at their planned size)` : "";
  return {
    total,
    cap,
    unit: budgets.unit,
    over: total > cap,
    line: `the page is ${total} ${budgets.unit} with this section${rest}; its cap is ${cap} (the other sections from ${source})`,
  };
}

/** What a per-section call needs to size section n: its planned size, check's cap, the rest of the page. */
function sectionSizing({ n, lang, budgets, outline, dir, page }) {
  const row = outline?.rows.find((r) => r.n === n);
  const sameUnit = !!outline && outline.unit === budgets.unit;
  const planned = plannedSize(row, outline, budgets);
  return {
    cap: rowCap(budgets, n, sameUnit ? row?.budget : undefined),
    planned,
    planRowSize:
      planned !== undefined && !sameUnit ? `${row.budget} ${UNIT_NAME[outline.unit]}` : undefined,
    others: pageAround(dir, lang, n, outline, budgets, page).others,
  };
}

/**
 * The size a per-section prompt asks for: the lowest of the section's planned size, what the page
 * has left once the rest of it takes its share, and the profile's cap. Never check's 1.1 ×
 * tolerance, so a round of fixes cannot walk every section up to it and the page over its cap. A
 * page already full without this section adds no ceiling; the page report says so instead.
 */
function sectionTarget(
  F,
  budgets,
  n,
  { planned, plannedKind = "planned", others, extra = 0, margin },
) {
  const unit = (k) => `${k} ${budgets.unitName}`;
  const limit = n === 0 ? budgets.lead : budgets.section;
  const parts = [];
  const params = {};
  if (planned > 0) {
    parts.push([planned, `budget-part-${plannedKind}`]);
    params.B_PLANNED = unit(planned);
  }
  if (budgets.total && others !== undefined) {
    const left = budgets.total.cap - others - extra;
    if (left >= Math.max(limit?.floor ?? 0, 1)) {
      parts.push([left, "budget-part-page"]);
      params.B_LEFT = unit(left);
      params.B_PAGE_CAP = String(budgets.total.cap);
      params.B_OTHERS = unit(others + extra);
    }
  }
  if (limit) {
    parts.push([limit.cap, n === 0 ? "budget-part-lead-cap" : "budget-part-section-cap"]);
    params.B_CAP = unit(limit.cap);
  }
  if (margin !== undefined) {
    parts.push([margin, "budget-part-margin"]);
    params.B_MARGIN = unit(margin);
  }
  params.SECTION_BUDGET_WHY = "";
  if (!parts.length) return { target: undefined, params };
  params.BUDGET_PARTS = parts.map(([, fragment]) => F[fragment]).join("; ");
  params.SECTION_BUDGET_WHY = ` ${F[parts.length > 1 ? "budget-why" : "budget-why-one"]}`;
  return { target: Math.min(...parts.map(([value]) => value)), params };
}

/** The outline's top-level `# ` parts, its plan rows and each section's bullets. */
function parseOutline(text) {
  const parts = {};
  let current = null;
  for (const line of text.split("\n")) {
    const h = /^# (.+?)\s*$/.exec(line);
    if (h) {
      current = h[1].trim();
      parts[current] = [];
    } else if (current) parts[current].push(line);
  }
  for (const k of Object.keys(parts)) parts[k] = parts[k].join("\n").trim();
  const tableLines = (parts.Plan ?? "").split("\n").filter((l) => /^\s*\|/.test(l));
  const cells = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const rows = [];
  let unit = "words";
  if (tableLines.length >= 2) {
    const header = cells(tableLines[0]).map((c) => c.toLowerCase().replace(/[`*]/g, ""));
    const col = (re) => header.findIndex((h) => re.test(h));
    const ci = {
      n: col(/^(n|#|no\.?|row)$/),
      heading: col(/^heading/),
      budget: col(/^(words|chars|characters|budget|字)/),
      facts: col(/^facts/),
      opinions: col(/^opinions/),
      figures: col(/^figures/),
      ends: col(/^ends/),
    };
    if (ci.budget >= 0 && /^(chars|characters|字)/.test(header[ci.budget])) unit = "chars";
    for (const l of tableLines.slice(1)) {
      if (/^\s*\|\s*:?-{3,}/.test(l)) continue;
      const c = cells(l);
      const get = (k) => (ci[k] >= 0 ? (c[ci[k]] ?? "") : "");
      rows.push({
        n: Number((get("n").match(/\d+/) ?? [NaN])[0]),
        heading: get("heading"),
        budget: Number((get("budget").match(/\d+/) ?? [NaN])[0]),
        facts: get("facts").match(/\bF\d+\b/g) ?? [],
        opinions: get("opinions").match(/\bO\d+\b/g) ?? [],
        figures: get("figures").match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? [],
        ends: get("ends"),
        line: l.trim(),
      });
    }
  }
  const sectionPlans = new Map();
  for (const chunk of (parts.Sections ?? "").split(/^(?=## )/m)) {
    const m = /^##\s*(?:section\s*)?(\d+)\b/i.exec(chunk.trim());
    if (m) sectionPlans.set(Number(m[1]), chunk.trim());
  }
  const header = tableLines.slice(0, 2).join("\n");
  return { parts, rows, unit, header, planTable: tableLines.join("\n"), sectionPlans };
}

/** Every way a plan breaks its budgets, its manifest or its facts. Empty when it is sound. */
function planProblems(outline, budgets, { facts, manifest } = {}) {
  const p = [];
  const { rows } = outline;
  if (!rows.length) {
    return [
      "no `# Plan` table with rows (n | heading | words | facts | opinions | figures | ends with)",
    ];
  }
  const u = budgets.unit;
  if (outline.unit !== u)
    p.push(
      `the plan counts ${outline.unit}; a ${u === "chars" ? "Chinese" : "English"} plan counts ${u}`,
    );
  rows.forEach((row, i) => {
    if (row.n !== i) {
      p.push(
        `row ${i + 1} is numbered ${Number.isNaN(row.n) ? "(none)" : row.n}; rows run 0, 1, 2, … with the lead as 0`,
      );
    }
    if (!(row.budget > 0)) p.push(`row ${i}: no ${u} number`);
  });
  const sum = rows.reduce((s, r) => s + (r.budget > 0 ? r.budget : 0), 0);
  if (budgets.total && sum > budgets.total.cap) {
    p.push(`the rows sum to ${sum} ${u}; the cap for the whole piece is ${budgets.total.cap}`);
  }
  for (const row of rows.slice(1)) {
    if (budgets.section && row.budget > budgets.section.cap) {
      p.push(`row ${row.n} asks for ${row.budget} ${u}; a section's cap is ${budgets.section.cap}`);
    }
  }
  const lead = rows[0];
  if (
    lead &&
    budgets.lead &&
    (lead.budget > budgets.lead.cap || lead.budget < budgets.lead.floor)
  ) {
    p.push(
      `row 0 (the lead) asks for ${lead.budget} ${u}; the lead stays within ${budgets.lead.floor}–${budgets.lead.cap}`,
    );
  }
  const count = rows.length - 1;
  if (budgets.sections && (count < budgets.sections.floor || count > budgets.sections.cap)) {
    p.push(
      `${count} sections after the lead; the profile asks for ${budgets.sections.floor} to ${budgets.sections.cap}`,
    );
  }
  if (manifest) {
    const owned = rows.flatMap((r) => r.figures);
    for (const stem of manifest) {
      const k = owned.filter((x) => x === stem).length;
      if (k !== 1)
        p.push(`figure ${stem} appears in ${k} rows; every figure belongs to exactly one`);
    }
    for (const stem of new Set(owned)) {
      if (!manifest.includes(stem)) p.push(`figure ${stem} is in the plan but not in the manifest`);
    }
  }
  if (facts) {
    for (const row of rows) {
      for (const id of [...row.facts, ...row.opinions]) {
        if (!facts.ids.has(id)) p.push(`row ${row.n} cites ${id}, which is not in the facts file`);
      }
    }
  }
  return p;
}

/** Entries of one facts section by id: the id's line and the indented lines under it. */
function factsEntries(sectionText) {
  const out = new Map();
  let current = null;
  for (const line of (sectionText ?? "").split("\n")) {
    const id = /^\s*(?:[-*]\s*)?(?:\*\*)?`?([FOS]\d+)\b/.exec(line)?.[1];
    if (id && !/^\s{2,}/.test(line)) {
      current = id;
      out.set(id, line);
    } else if (current && /^\s+\S/.test(line)) out.set(current, `${out.get(current)}\n${line}`);
    else current = null;
  }
  return out;
}

/** What one section may cite: its facts and opinions, their sources, and the terms and limits in full. */
function factsSubset(F, factsText, row) {
  const pick = (name, ids) => {
    const entries = factsEntries(factsSection(factsText, name));
    const lines = ids.map((id) => entries.get(id)).filter(Boolean);
    return lines.length ? lines.join("\n") : "(none)";
  };
  const factLines = pick("FACTS", row.facts);
  const sourceIds = [...new Set(factLines.match(/\bS\d+\b/g) ?? [])];
  const parts = [
    F["facts-subset-intro"],
    factLines,
    "",
    "## OPINIONS",
    pick("OPINIONS", row.opinions),
  ];
  if (sourceIds.length && factsSection(factsText, "SOURCES") !== undefined) {
    parts.push("", "## SOURCES (of these facts)", pick("SOURCES", sourceIds));
  }
  parts.push("", "## TERMS", factsSection(factsText, "TERMS") ?? "(none)");
  parts.push("", "## NOT-FACTS", factsSection(factsText, "NOT-FACTS") ?? "(none)");
  return parts.join("\n");
}

/** The outline's head for a section call: thesis and reader, and for the lead the title candidates. */
function outlineHead(outline, n) {
  const pick = ["Thesis", "Reader and takeaway", ...(n === 0 ? ["Title candidates"] : [])];
  return pick
    .filter((k) => outline.parts[k] !== undefined)
    .map((k) => `# ${k}\n${outline.parts[k]}`)
    .join("\n\n");
}

/** The manifest lines that name the given figure stems, under the manifest's table header. */
function manifestRows(manifestText, stems) {
  if (!stems.length) return "none";
  if (!manifestText) return stems.join(", ");
  const lines = manifestText.split("\n");
  const header = lines.filter((l) => /^\s*\|/.test(l)).slice(0, 2);
  const hits = lines.filter((l) =>
    stems.some((s) => new RegExp(`(^|[^a-z0-9-])${s}([^a-z0-9-]|$)`).test(l)),
  );
  const tableHits = hits.filter((l) => /^\s*\|/.test(l));
  return tableHits.length && header.length === 2
    ? [...header, ...tableHits].join("\n")
    : hits.join("\n");
}

/** Sections 0 … n−1 of one language, latest versions, fenced; a gap is an error. */
function previousSections(F, dir, n, lang) {
  if (n === 0) return F["previous-none"];
  const parts = [];
  for (let k = 0; k < n; k++) {
    const s = latestSection(dir, k, lang);
    if (!s) fail(`section s${k}.${lang} is missing in ${dir}: sections are written in order`);
    parts.push(read(s.file).trim());
  }
  return `\`\`\`\`markdown\n${parts.join("\n\n")}\n\`\`\`\``;
}

/** Sections n−1 and n+1 of one language, latest versions, for context only. */
function neighbourText(dir, n, lang) {
  const parts = [];
  for (const k of [n - 1, n + 1]) {
    const s = k >= 0 ? latestSection(dir, k, lang) : undefined;
    if (s) parts.push(`### Section ${k}\n\`\`\`\`markdown\n${read(s.file).trim()}\n\`\`\`\``);
  }
  return parts.length ? parts.join("\n\n") : "(none)";
}

/** Section mode for translate / polish / fix / review: a `s<n>.…` input or --sections-dir. */
function sectionModeOf(o) {
  const fromName = sectionOfFile(o.in);
  if (!fromName && !o["sections-dir"]) return undefined;
  const n = o.section !== undefined ? Number(o.section) : fromName?.n;
  if (n === undefined || Number.isNaN(n)) {
    fail("section mode needs an input named s<n>.<lang>.v<k>.md, or --section <n>");
  }
  return { n, dir: o["sections-dir"] ?? path.dirname(o.in) };
}

/** --feedback takes text, @file, or the path of an existing file. */
function feedbackText(value) {
  if (value.startsWith("@")) return read(value.slice(1), "--feedback").trim();
  if (existsSync(value)) return read(value, "--feedback").trim();
  return value.trim();
}

/** The figure ids a text's figure blocks carry, in order. */
function figureIdsIn(text) {
  return [...figureBlockTexts(text).keys()];
}

/**
 * The size check's counting rule for a budget-bound prompt, with an example sentence counted by
 * countBody itself, so the number the model reads is the number check computes.
 */
function countRuleParams(F, lang) {
  const example = F[`count-example-${lang}`];
  return {
    COUNT_RULE: F[`count-rule-${lang}`],
    COUNT_EXAMPLE: `"${example}"`,
    COUNT_EXAMPLE_N: `${countBody(example, lang)} ${lang === "zh" ? "characters" : "words"}`,
  };
}

/** The contract and budget slots a call that returns one section needs. */
function sectionParams(
  F,
  prof,
  lang,
  n,
  {
    cap,
    planned,
    plannedKind,
    planRowSize,
    others,
    extra,
    now,
    budgets,
    figureIds,
    markers,
    date,
    versionNote,
  },
) {
  const params = profileParams(F, prof, lang, { contract: true, markers, date, versionNote });
  Object.assign(params, countRuleParams(F, lang));
  params.CONTRACT = read(path.join(PROMPTS, "contract-section.md")).trim();
  // fix and polish see the section they change, so they are told its size by the same rule.
  params.SECTION_NOW = now !== undefined ? ` ${F["section-now"]}` : "";
  params.SECTION_NOW_COUNT = now !== undefined ? `${now} ${budgets.unitName}` : "";
  params.SECTION_N = String(n);
  params.SECTION_SHAPE = n === 0 ? F["section-shape-lead"] : F["section-shape-body"];
  const sized = sectionTarget(F, budgets, n, { planned, plannedKind, others, extra });
  Object.assign(params, sized.params);
  const budget = sized.target ?? cap;
  params.SECTION_BUDGET =
    budget !== undefined ? `${budget} ${budgets.unitName}` : "the size the plan gives";
  // A plan in the other language's unit sizes this section through the translation ratio.
  params.SECTION_PLAN_NOTE = planRowSize ? ` ${F["plan-other-unit"]}` : "";
  params.PLAN_UNIT_NAME = planRowSize ? planRowSize.replace(/^\d+ /, "") : "";
  params.PLAN_ROW_SIZE = planRowSize ?? "";
  params.ZH_RATIO = String(ZH_PER_EN);
  params.SECTION_FIGURE_IDS = figureIds.length ? figureIds.join(", ") : "none";
  params.TLDR_NOTE = "";
  if (n === 0 && budgets.tldr) {
    params.TLDR_NOTE = ` ${F["tldr-budget"]}`;
    params.TLDR_RANGE = `${budgets.tldr.floor}–${budgets.tldr.cap} ${budgets.unitName}`;
  }
  return params;
}

function buildMessages(step, o) {
  const F = loadFragments();
  let params = {};
  const content = {};
  let lang;
  const hooks = {};

  const meme = o.meme ? F["meme-brief"] : "";
  if (o.meme) content.MEME_BRIEF = read(o.meme, "--meme").trim();
  // The author's notes go to every step that writes or judges the text, as a binding list.
  const notes = o.notes ? notesOf(o.notes) : undefined;
  if (o.notes) content.NOTES = read(o.notes, "--notes").trim();
  const notesSlots = () => ({
    NOTES_SECTION: notes ? `${F["notes-section"]}\n\n` : "",
    NOTES_RULE: notes ? ` ${F["notes-rule-write"]}` : "",
  });
  if (o.facts) content.FACTS = read(o.facts, "--facts").trim();
  const titleRule = o["title-rule"] !== undefined ? textOrFile(o["title-rule"]) : undefined;
  const input = o.in ? read(o.in, "--in") : undefined;
  const doc = input !== undefined ? splitFrontmatter(input) : { meta: {}, body: "" };
  const prof = resolveProfile(o, doc.meta);
  const sec = ["translate", "polish", "fix", "trim", "review"].includes(step)
    ? sectionModeOf(o)
    : undefined;
  // The plan, when one is given and counts in this language's unit, sizes a section call.
  const outlineGiven = () => (o.outline ? parseOutline(read(o.outline, "--outline")) : undefined);
  // After any per-section step: the page total with the new section, so creep shows early.
  const pageNote = (ctx) => (out) => {
    const page = pageReport(ctx.dir, ctx.lang, ctx.n, out, ctx.outline, ctx.budgets, o.page);
    if (page)
      note(`page: ${page.line}${page.over ? "; over, so trim a section before assembling" : ""}`);
  };
  const both = (a, b) => (out) => {
    a?.(out);
    b?.(out);
  };

  switch (step) {
    case "outline": {
      lang = checkLang(o.lang ?? langOf(o.out) ?? "en", "--lang");
      params = profileParams(F, prof, lang);
      params.STYLE = stylePrompt(lang);
      params.TITLE_RULE = titleRule ?? "";
      params.MEME_BRIEF_SECTION = meme;
      const b = budgetsOf(prof, lang, o);
      if (o["word-budget"] !== undefined) params.WORD_BUDGET = o["word-budget"];
      else if (b.total) {
        params.WORD_BUDGET = `${b.total.floor}–${b.total.cap} ${b.unitName} of body, at most ${b.total.cap}`;
      }
      params.BUDGET_UNIT = b.unit;
      params.BUDGET_UNIT_DESC = b.unitName;
      Object.assign(params, countRuleParams(F, lang));
      if (b.total) params.WORD_CAP = `${b.total.cap}`;
      if (b.section) params.SECTION_CAP = `${b.section.cap}`;
      if (b.lead) params.LEAD_RANGE = `${b.lead.floor}–${b.lead.cap}`;
      params.TLDR_PLAN_NOTE = b.tldr ? ` ${F["tldr-plan"]}` : "";
      if (b.tldr) params.TLDR_RANGE = `${b.tldr.floor}–${b.tldr.cap} ${b.unitName}`;
      params.SECTION_RANGE = b.sections
        ? `${b.sections.floor} to ${b.sections.cap}`
        : "the outline's number of";
      if (o["figure-count"] !== undefined) params.FIGURE_COUNT = o["figure-count"];
      if (o.brief) content.BRIEF = read(o.brief, "--brief").trim();
      content.RESEARCH_SUMMARY = researchText(o.research);
      if (o.feedback) {
        params.FEEDBACK = F["outline-feedback"];
        content.FEEDBACK_NOTES = feedbackText(o.feedback);
        if (o.previous) content.PREVIOUS_OUTLINE = read(o.previous, "--previous").trim();
      } else {
        if (o.previous) fail("--previous only goes with --feedback");
        params.FEEDBACK = "";
      }
      hooks.after = (out) => validateOutline(out, o, prof, lang);
      break;
    }
    case "write": {
      lang = checkLang(o.lang ?? langOf(o.out) ?? "en", "--lang");
      const budgets = budgetsOf(prof, lang, o);
      const post = prof.kind === "post";
      params = profileParams(F, prof, lang, {
        contract: true,
        markers: "write",
        date: o.date ?? today(),
        versionNote: o["version-note"],
        budgets,
      });
      Object.assign(params, notesSlots());
      params.STYLE = stylePrompt(lang);
      params.TITLE_RULE = [
        o.title !== undefined ? F["title-fixed"] : F["title-rule-write"],
        titleRule,
      ]
        .filter(Boolean)
        .join(" ");
      params.TITLE_FIXED = o.title ?? "";
      params.MEME_BRIEF_SECTION = meme;
      // A post is one argument written in one sitting; its plan sizes are targets, its caps limits.
      params.FLOW_RULE = post ? F["flow-rule-post"] : "";
      params.PLAN_TARGETS = post && o.outline ? ` ${F["plan-targets"]}` : "";
      params.FIGURE_REUSE_RULE = "";
      params.EXISTING_FIGURE_BLOCKS = "";
      if (o["reuse-figures"]) {
        const blocks = figureBlockTexts(read(o["reuse-figures"], "--reuse-figures"));
        if (blocks.size) {
          params.FIGURE_REUSE_RULE = F["figure-reuse"];
          params.EXISTING_FIGURE_BLOCKS = F["existing-figure-blocks"];
          content.EXISTING_BLOCKS = [...blocks.values()].join("\n\n");
        }
      }
      if (o.feedback) {
        if (!o.previous) fail("write --feedback needs --previous <the attempt it is about>");
        params.FEEDBACK = F["write-feedback"];
        content.FEEDBACK_NOTES = feedbackText(o.feedback);
        content.PREVIOUS_PIECE = read(o.previous, "--previous").trim();
      } else {
        if (o.previous) fail("--previous only goes with --feedback");
        params.FEEDBACK = "";
      }
      if (o.outline) content.OUTLINE = read(o.outline, "--outline").trim();
      if (o.figures) content.FIGURES = read(o.figures, "--figures").trim();
      else if (!post) content.FIGURES = "(none: this text has no figures)";
      if (!o.out && o.outline && post) o.out = nextDraftIn(path.dirname(o.outline), lang);
      hooks.verify = (out) => [
        ...versionNoteProblems(out, o["version-note"]),
        ...titleProblems(out, o.title),
        ...notesProblems(out, notes, lang),
        ...(post ? writeHardProblems(out, budgets) : []),
      ];
      hooks.retry =
        "rerun write once with --feedback naming what was wrong and --previous the rejected answer; a second failure goes to the author";
      if (post) hooks.after = (out) => writeAfter(out, { o, lang, budgets, prof });
      break;
    }
    case "section": {
      if (!o.outline) fail("section needs --outline <outline.final.md>");
      if (o.section === undefined) fail("section needs --section <n>");
      const n = Number(o.section);
      const dir = o["sections-dir"] ?? (o.out ? path.dirname(o.out) : undefined);
      if (!dir) fail("section needs --sections-dir <dir>");
      lang = checkLang(o.lang ?? langOf(o.out) ?? "en", "--lang");
      o.out ??= nextSectionFile(dir, n, lang);
      const outline = parseOutline(read(o.outline, "--outline"));
      const row = outline.rows.find((r) => r.n === n);
      if (!row) fail(`the outline's plan has no row ${n}`);
      const budgets = budgetsOf(prof, lang, o);
      const sizing = sectionSizing({ n, lang, budgets, outline, dir, page: o.page });
      const cap = sizing.cap;
      params = sectionParams(F, prof, lang, n, {
        ...sizing,
        budgets,
        figureIds: row.figures,
        markers: "write",
        date: o.date ?? today(),
        versionNote: o["version-note"],
      });
      params.STYLE = stylePrompt(lang);
      params.SECTION_COUNT = String(outline.rows.length);
      params.TITLE_RULE = n === 0 ? (titleRule ?? F["title-rule-section"]) : "";
      params.MEME_BRIEF_SECTION = meme;
      params.FIGURE_REUSE_RULE = "";
      params.EXISTING_FIGURE_BLOCKS = "";
      if (o["reuse-figures"] && row.figures.length) {
        const blocks = figureBlockTexts(read(o["reuse-figures"], "--reuse-figures"));
        const found = row.figures.map((id) => blocks.get(id)).filter(Boolean);
        if (found.length) {
          params.FIGURE_REUSE_RULE = F["figure-reuse"];
          params.EXISTING_FIGURE_BLOCKS = F["existing-figure-blocks"];
          content.EXISTING_BLOCKS = found.join("\n\n");
        }
      }
      if (o.feedback) {
        params.FEEDBACK = F["section-feedback"];
        content.FEEDBACK_NOTES = feedbackText(o.feedback);
        const prev = o.previous ?? latestSection(dir, n, lang)?.file;
        if (!prev) fail("--feedback needs --previous <the attempt it is about>");
        content.PREVIOUS_SECTION = read(prev, "--previous").trim();
      } else params.FEEDBACK = "";
      content.OUTLINE_HEAD = outlineHead(outline, n);
      content.PLAN_TABLE = outline.planTable;
      content.SECTION_PLAN = [`${outline.header}\n${row.line}`, outline.sectionPlans.get(n) ?? ""]
        .filter(Boolean)
        .join("\n\n");
      content.SECTION_FIGURES = manifestRows(
        o.figures ? read(o.figures, "--figures") : "",
        row.figures,
      );
      content.PREVIOUS_SECTIONS = previousSections(F, dir, n, lang);
      if (content.FACTS === undefined) fail("section needs --facts <facts.md>");
      content.FACTS_SUBSET = o["facts-all"] ? content.FACTS : factsSubset(F, content.FACTS, row);
      const kinds = figureKinds(o);
      hooks.after = both(
        (out) =>
          sectionAfter(out, { n, lang, row, budgets, cap, kinds, file: o.out, outline: o.outline }),
        pageNote({ dir, lang, n, outline, budgets }),
      );
      break;
    }
    case "translate": {
      if (!o.to) fail("translate needs --to en|zh");
      lang = checkLang(o.to, "--to");
      if (input === undefined) fail("translate needs --in <source>");
      const sourceLang = langOf(o.in) ?? (lang === "en" ? "zh" : "en");
      if (sourceLang === lang) fail(`--in is already ${lang}; --to names the other language`);
      const sourceNote = versionNoteOf(doc);
      if (sourceNote && o["version-note"] === undefined) {
        fail(
          `the source carries a version note ("${sourceNote}"); pass --version-note with the ${LANG_NAME[lang]} line, or "none"`,
        );
      }
      const shared = {
        markers: "keep",
        date: o.date ?? doc.meta.date ?? today(),
        versionNote: o["version-note"],
      };
      if (sec) {
        if (!o.outline) fail("translate in section mode needs --outline <outline.final.md>");
        const outline = parseOutline(read(o.outline, "--outline"));
        const budgets = budgetsOf(prof, lang, o);
        const sourceCount = countBody(input, sourceLang);
        const planned = Math.round(
          lang === "zh" ? sourceCount * ZH_PER_EN : sourceCount / ZH_PER_EN,
        );
        params = sectionParams(F, prof, lang, sec.n, {
          ...shared,
          cap: rowCap(budgets, sec.n, undefined),
          planned,
          plannedKind: "translated",
          others: pageAround(sec.dir, lang, sec.n, outline, budgets, o.page).others,
          budgets,
          figureIds: figureIdsIn(input),
        });
        params.SECTION_CONTEXT = `${F["translated-context"]}\n\n`;
        params.SOURCE_LABEL = `Source section ${sec.n}`;
        content.PLAN_TABLE = outline.planTable;
        content.PREVIOUS_SECTIONS = previousSections(F, sec.dir, sec.n, lang);
        o.out ??= nextSectionFile(sec.dir, sec.n, lang);
        hooks.after = pageNote({ dir: sec.dir, lang, n: sec.n, outline, budgets });
      } else {
        params = profileParams(F, prof, lang, {
          contract: true,
          ...shared,
          budgets: budgetsOf(prof, lang, o),
        });
        params.SECTION_CONTEXT = "";
        params.SOURCE_LABEL = `Source ${NOUN[prof.kind]}`;
      }
      params.STYLE_TARGET = stylePrompt(lang);
      params.TARGET_LANG_NAME = LANG_NAME[lang];
      params.SOURCE_LANG_NAME = LANG_NAME[sourceLang];
      params.SOURCE_LANG = sourceLang;
      params.TITLE_RULE =
        o.title !== undefined ? F["title-fixed"] : (titleRule ?? F[`title-rule-translate-${lang}`]);
      params.TITLE_FIXED = o.title ?? "";
      Object.assign(params, notesSlots());
      content.SOURCE = input.trim();
      if (content.FACTS !== undefined) {
        const terms = factsSection(content.FACTS, "TERMS");
        if (terms !== undefined) content.TERMS = terms;
      }
      if (o["reuse-figures"]) {
        if (!o["reuse-source"]) {
          fail(
            "--reuse-figures on translate needs --reuse-source <the frozen draft in the source language>",
          );
        }
        hooks.transform = (out) =>
          reuseTranslatedFigures(out, input, read(o["reuse-source"]), read(o["reuse-figures"]));
      }
      const noteKept = sec && sec.n > 0 ? undefined : o["version-note"];
      const title = sec && sec.n > 0 ? undefined : o.title;
      hooks.verify = (out) => [
        ...versionNoteProblems(out, noteKept),
        ...titleProblems(out, title),
        ...notesProblems(out, notes, lang),
      ];
      hooks.retry = "rerun translate once; a second failure goes to the author";
      if (!sec && prof.kind === "post") {
        hooks.after = (out) => docReport(out, lang, budgetsOf(prof, lang, o), outlineGiven());
      }
      break;
    }
    case "polish":
    case "fix": {
      if (input === undefined) fail(`${step} needs --in <draft>`);
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      const shared = {
        markers: step === "polish" ? "keep" : "fix",
        date: o.date ?? doc.meta.date ?? today(),
        versionNote: o["version-note"] ?? versionNoteOf(doc),
      };
      const budgets = budgetsOf(prof, lang, o);
      const outlineInput =
        !sec && (/^outline/.test(path.basename(o.in)) || /^# (Plan|Sections)\s*$/m.test(input));
      // The note the answer must carry: a section after the lead has none, whatever is passed.
      const noteKept = sec && sec.n > 0 ? versionNoteOf(doc) : shared.versionNote;
      if (sec) {
        const outline = outlineGiven();
        const sizing = sectionSizing({
          n: sec.n,
          lang,
          budgets,
          outline,
          dir: sec.dir,
          page: o.page,
        });
        const cap = sizing.cap;
        const now = sectionSize(input, sec.n, lang);
        if (!outline && cap !== undefined) {
          note(
            "no --outline: the prompt cannot state this section's planned size, only the profile's cap and what the page has left; pass --outline",
          );
        }
        params = sectionParams(F, prof, lang, sec.n, {
          ...shared,
          ...sizing,
          now,
          extra: sec.n === 0 ? (leadCounts(input, lang).tldr ?? 0) : 0,
          budgets,
          figureIds: figureIdsIn(input),
        });
        params.NEIGHBOURS = `${F.neighbours}\n\n`;
        content.NEIGHBOUR_TEXT = neighbourText(sec.dir, sec.n, lang);
        params.DRAFT_LABEL = `Section ${sec.n} (return this section only)`;
        params.DRAFT_HEADING = `## Section ${sec.n} (the one to edit; return it only)\n`;
        const page = pageNote({ dir: sec.dir, lang, n: sec.n, outline, budgets });
        hooks.after = page;
        if (step === "fix") {
          o.out ??= nextSectionFile(sec.dir, sec.n, lang);
          hooks.after = both((out) => {
            const size = sectionSize(out, sec.n, lang);
            if (cap !== undefined && size > cap) {
              note(
                `over budget after the fix: ${size} ${budgets.unit} > ${cap}; next: trim --in ${o.out}${o.outline ? ` --outline ${o.outline}` : ""}`,
              );
            }
          }, page);
        }
      } else {
        params = profileParams(F, prof, lang, { contract: true, ...shared, budgets });
        params.NEIGHBOURS = "";
        params.DRAFT_LABEL = NOUN[prof.kind][0].toUpperCase() + NOUN[prof.kind].slice(1);
        params.DRAFT_HEADING = "";
        // A whole post: its sizes against the caps after the edit, so creep shows at once. An
        // outline is no post: its plan is validated instead.
        if (outlineInput) {
          hooks.after = (out) => {
            const problems = planProblems(parseOutline(out), budgets, {
              facts: o.facts ? loadFacts(o.facts) : undefined,
              manifest: o.figures ? manifestStems(read(o.figures, "--figures")) : undefined,
            });
            for (const p of problems) note(`plan: ${p}`);
            if (!problems.length)
              note("plan: within budget, every figure placed once, every id in FACTS");
          };
        } else if (prof.kind === "post") {
          hooks.after = (out) => {
            const sizes = docReport(out, lang, budgets, outlineGiven());
            if (sizes.over.length || sizes.pageOver) {
              note(
                `over a cap after the ${step}: trim --in ${o.out}${o.outline ? ` --outline ${o.outline}` : ""}`,
              );
            }
          };
        }
      }
      Object.assign(params, notesSlots());
      params[step === "polish" ? "STYLE_TARGET" : "STYLE"] = stylePrompt(lang);
      hooks.verify = (out) => versionNoteProblems(out, noteKept);
      hooks.retry = `rerun ${step} once; a second failure goes to the author`;
      if (step === "polish") Object.assign(params, tells(F, lang));
      else if (o.findings) {
        content.FINDINGS = read(o.findings, "--findings").trim();
        hooks.verify = (out) => [
          ...fixProblems(input, out, content.FINDINGS, { whole: !sec && !outlineInput }),
          ...versionNoteProblems(out, noteKept),
          ...notesProblems(out, notes, lang),
        ];
        hooks.retry =
          "rerun fix once (a finding that names the id, or names the figure by its id or by quoting it, lets that change through); a second failure goes to the author";
      }
      content.DRAFT = sec ? fenced(input) : input.trim();
      break;
    }
    case "trim": {
      if (input === undefined) fail("trim needs --in <s<n>.<lang>.v<k>.md or draft.<lang>.vN.md>");
      if (!sec) {
        if (!/^draft\.(en|zh)\.v\d+\.md$/.test(path.basename(o.in))) {
          fail(
            "trim cuts one section (s<n>.<lang>.v<k>.md, or --section <n> with --sections-dir) or a whole draft (draft.<lang>.vN.md)",
          );
        }
        lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
        const budgets = budgetsOf(prof, lang, o);
        const outline = outlineGiven();
        const plan = trimPlan(input, lang, budgets);
        if (!plan.named.size) {
          hooks.skip = `every section is within its cap and the page is ${plan.total} ${budgets.unit}${plan.pageCap !== undefined ? ` of at most ${plan.pageCap}` : ""}: nothing to trim`;
        }
        const unit = (k) => `${k} ${budgets.unitName}`;
        const where = (n) => (n === 0 ? "the lead" : `section ${n} ("${plan.headings[n]}")`);
        params = { NOUN: NOUN[prof.kind], ...countRuleParams(F, lang) };
        params.STYLE = stylePrompt(lang);
        params.TRIM_SCOPE = F["trim-scope-doc"];
        params.TRIM_WHAT = NOUN[prof.kind];
        params.TRIM_NAMED = [...plan.named.keys()].map(where).join(", ");
        params.TRIM_BUDGET = F["trim-budget-doc"];
        params.TRIM_PAGE_CAP =
          plan.pageCap !== undefined ? unit(plan.pageCap) : "the profile's size";
        params.TRIM_PAGE_NOW = unit(plan.total);
        params.TRIM_SECTIONS = [...plan.named]
          .map(([n, x]) =>
            F["trim-section-line"]
              .replace("{{TRIM_WHERE}}", where(n))
              .replace("{{TRIM_LINE_NOW}}", unit(x.now))
              .replace("{{TRIM_LINE_CAP}}", unit(x.cap))
              .replace("{{TRIM_LINE_AIM}}", unit(x.aim))
              .replace("{{TRIM_LINE_FLOOR}}", unit(x.floor)),
          )
          .join("\n");
        params.TRIM_TLDR = "";
        const noteKept = versionNoteOf(doc);
        params.TRIM_KEEP_NOTE = noteKept ? `, ${F["trim-keep-note"]},` : "";
        params.DRAFT_LABEL = `The ${NOUN[prof.kind]} (cut only the sections named; return it whole)`;
        content.DRAFT = fenced(input);
        o.out ??= nextDraftFile(o.in);
        hooks.transform = (out) => restoreFigureBlocks(out, input);
        hooks.verify = (out) => [
          ...trimDocProblems(input, out, { plan, lang, budgets, where }),
          ...versionNoteProblems(out, noteKept),
        ];
        hooks.retry = "rerun trim once; a second failure goes to the author";
        hooks.after = (out) => docReport(out, lang, budgets, outline);
        break;
      }
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      const budgets = budgetsOf(prof, lang, o);
      const outline = outlineGiven();
      const sizing = sectionSizing({
        n: sec.n,
        lang,
        budgets,
        outline,
        dir: sec.dir,
        page: o.page,
      });
      const sectionCap = o.cap !== undefined ? Number(o.cap) : sizing.cap;
      if (!(sectionCap > 0)) {
        fail(
          "trim needs a cap: --cap <n>, or --outline <outline.final.md> and a profile with section caps",
        );
      }
      const unit = (k) => `${k} ${budgets.unitName}`;
      const now = sectionSize(input, sec.n, lang);
      const tldrNow = sec.n === 0 ? leadCounts(input, lang).tldr : undefined;
      // With --page, what the assembled page has left is a cap as well, so a page over its cap is
      // cut here even when this section is within its own. The newest files are only a guess at
      // the page, so without --page they produce a note and no cut.
      const limit = sec.n === 0 ? budgets.lead : budgets.section;
      const left = budgets.total ? budgets.total.cap - sizing.others - (tldrNow ?? 0) : undefined;
      const usable = left !== undefined && left >= Math.max(limit?.floor ?? 0, 1);
      const cap = o.cap === undefined && o.page && usable && left < sectionCap ? left : sectionCap;
      if (o.cap === undefined && !o.page && usable && left < now && now <= sectionCap) {
        note(
          `the newest section files put the page over its cap; pass --page <assembled draft> to cut this section to what the page has left (${left})`,
        );
      }
      if (o.page && left !== undefined && !usable) {
        note(
          `the page is over its cap by more than this section can give (${left} left); trim the other sections`,
        );
      }
      const tldrCap = tldrNow !== undefined ? budgets.tldr?.cap : undefined;
      const tldrOver = tldrCap !== undefined && tldrNow > tldrCap;
      if (now <= cap && !tldrOver) {
        hooks.skip = `section ${sec.n} is ${now} ${budgets.unit} of at most ${cap}: nothing to trim`;
      }
      params = { NOUN: NOUN[prof.kind], SECTION_N: String(sec.n), ...countRuleParams(F, lang) };
      params.STYLE = stylePrompt(lang);
      params.TRIM_SCOPE = F["trim-scope-section"];
      params.TRIM_WHAT = "section";
      params.DRAFT_LABEL = `Section ${sec.n} (the one to cut; return it whole)`;
      params.TRIM_BUDGET = now > cap ? F["trim-budget"] : F["trim-budget-within"];
      params.TRIM_CAP = unit(cap);
      params.TRIM_NOW = unit(now);
      params.TRIM_EXCESS = unit(now - cap);
      // The aim is what a section prompt asks for, and never closer to the cap than the margin.
      const aim = sectionTarget(F, budgets, sec.n, {
        planned: sizing.planned,
        others: sizing.others,
        extra: tldrNow ?? 0,
        margin: Math.floor(cap * TRIM_AIM),
      });
      Object.assign(params, aim.params);
      params.TRIM_AIM = unit(aim.target);
      const noteKept = versionNoteOf(doc);
      params.TRIM_KEEP_NOTE = noteKept ? `, ${F["trim-keep-note"]},` : "";
      params.TRIM_TLDR = tldrOver ? ` ${F["trim-tldr"]}` : "";
      if (tldrOver) {
        params.TLDR_CAP = unit(tldrCap);
        params.TLDR_NOW = unit(tldrNow);
      }
      content.DRAFT = fenced(input);
      o.out ??= nextSectionFile(sec.dir, sec.n, lang);
      const limits = { n: sec.n, lang, cap, tldrCap, unit: budgets.unit };
      hooks.transform = (out) => restoreFigureBlocks(out, input);
      hooks.verify = (out) => [
        ...trimProblems(input, out, limits),
        ...versionNoteProblems(out, noteKept),
      ];
      hooks.retry = "rerun trim once; a second failure goes to the author";
      hooks.after = both(
        (out) => {
          process.stderr.write(
            `trim: section ${sec.n}, ${now} → ${sectionSize(out, sec.n, lang)} ${budgets.unit} of at most ${cap}; markers, footnotes and figure blocks unchanged\n`,
          );
        },
        pageNote({ dir: sec.dir, lang, n: sec.n, outline, budgets }),
      );
      break;
    }
    case "emphasize": {
      if (input === undefined) fail("emphasize needs --in <draft>");
      if (sectionOfFile(o.in)) fail("emphasize marks a whole draft: assemble the sections first");
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      const budgets = budgetsOf(prof, lang, o);
      if (!budgets.emphasis) fail(`profile ${prof.name} has no \`emphasis: yes\` setting`);
      params = profileParams(F, prof, lang);
      Object.assign(params, countRuleParams(F, lang));
      params.EMPHASIS_CAP = `${budgets.emphasis.cap} ${budgets.unitName}`;
      // The author's notes say which sentence a section's span belongs on; the text stays as it is.
      Object.assign(params, notesSlots());
      params.NOTES_RULE = notes ? ` ${F["notes-rule-emphasize"]}` : "";
      params.MIRROR_RULE = "";
      params.MIRROR_SECTION = "";
      let mirror;
      if (o.mirror) {
        mirror = read(o.mirror, "--mirror");
        if (!emphasisCheck(mirror, langOf(o.mirror) ?? "en", {}).spans.some((x) => x.length)) {
          fail(`--mirror ${o.mirror} has no emphasized span; emphasize that language first`);
        }
        params.MIRROR_LANG_NAME = LANG_NAME[langOf(o.mirror) ?? (lang === "zh" ? "en" : "zh")];
        params.MIRROR_RULE = F["emphasis-mirror-rule"];
        params.MIRROR_SECTION = `${F["emphasis-mirror-section"]}\n\n`;
        content.MIRROR = fenced(mirror);
      }
      content.DRAFT = fenced(input);
      o.out ??= nextDraftFile(o.in);
      hooks.transform = (out) => restoreFigureBlocks(out, input);
      hooks.verify = (out) => emphasizeProblems(input, out, lang, budgets);
      hooks.retry = "rerun emphasize once; a second failure goes to the author";
      if (mirror) {
        hooks.after = (out) => {
          const mine = emphasisCheck(out, lang, {}).spans;
          const theirs = emphasisCheck(mirror, langOf(o.mirror) ?? "en", {}).spans;
          mine.forEach((spans, i) => {
            const nums = (xs) => xs.flatMap((x) => x.text.match(/\d+(?:[.,]\d+)*/g) ?? []).join();
            if (nums(spans) !== nums(theirs[i] ?? [])) {
              note(
                `section ${i}: the emphasized span holds other numbers than the mirror's; pair will warn`,
              );
            }
          });
        };
      }
      break;
    }
    case "transition": {
      if (input === undefined) fail("transition needs --in <draft>");
      if (sectionOfFile(o.in)) fail("transition edits a whole draft's joins: assemble it first");
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      params = profileParams(F, prof, lang);
      params.STYLE = stylePrompt(lang);
      params.FLOW_RULE = F["flow-rule-post"];
      Object.assign(params, notesSlots());
      params.NOTES_RULE = notes ? ` ${F["notes-rule-transition"]}` : "";
      params.FINDINGS_RULE = "";
      params.FINDINGS_SECTION = "";
      if (o.findings) {
        // Only the findings about joins go along: the step may not act on any other.
        const joins = findingItems(read(o.findings, "--findings")).filter(({ item }) =>
          /\b(transition|signpost)\b/i.test(item),
        );
        if (joins.length) {
          params.FINDINGS_RULE = ` ${F["transition-findings-rule"]}`;
          params.FINDINGS_SECTION = `${F["transition-findings-section"]}\n\n`;
          content.FINDINGS = joins.map((x) => x.item).join("\n");
        } else {
          note(`${o.findings} has no transition or signpost finding; the call judges every join`);
        }
      }
      content.DRAFT = fenced(input);
      o.out ??= nextDraftFile(o.in);
      if (!joinsOf(blocksOf(input).blocks).some((j) => j.after !== undefined)) {
        hooks.skip = "no `## ` heading is followed by a paragraph: no join to edit";
      }
      hooks.transform = (out) => restoreFigureBlocks(out, input);
      hooks.verify = (out) => [
        ...transitionProblems(input, out),
        ...notesProblems(out, notes, lang),
      ];
      hooks.retry = "rerun transition once; a second failure goes to the author";
      hooks.after = (out) => transitionReport(input, out, o.out);
      break;
    }
    case "review": {
      if (input === undefined) fail("review needs --in <draft>");
      lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
      params = profileParams(F, prof, lang);
      params.STYLE = stylePrompt(lang);
      if (o.tells) Object.assign(params, tells(F, lang));
      else params.TELLS = F["review-no-tells"];
      // Fragments are trimmed; the rule follows a sentence and the section precedes a heading.
      params.FACTS_RULE = content.FACTS !== undefined ? ` ${F["review-facts-rule"]}` : "";
      params.FACTS_SECTION = content.FACTS !== undefined ? `${F["review-facts-section"]}\n\n` : "";
      Object.assign(params, notesSlots());
      params.NOTES_RULE = notes ? ` ${F["notes-rule-review"]}` : "";
      // The key sentences emphasize adds are expected, and a post with `body-lists: none` has
      // the TL;DR as its only list: the review must not ask for what check refuses.
      params.EMPHASIS_RULE = budgetsOf(prof, lang, o).emphasis
        ? ` ${F["review-emphasis-rule"]}`
        : "";
      params.LIST_RULE =
        profileSettings(prof)["body-lists"] === "none"
          ? F["review-lists-prose"]
          : F["review-lists"];
      if (sec) {
        params.SCOPE = F["review-scope-section"];
        params.NEIGHBOURS = `${F.neighbours}\n\n`;
        content.NEIGHBOUR_TEXT = neighbourText(sec.dir, sec.n, lang);
        params.DRAFT_LABEL = `Section ${sec.n} (the one to review)`;
      } else {
        params.SCOPE = F["review-scope-post"];
        params.NEIGHBOURS = "";
        // The joins are scored in one closing line, kept apart so route and fix never read it.
        hooks.after = (out) => {
          const flow = /^\s*transitions:.*$/im.exec(out);
          if (!flow) {
            note("the review gave no `transitions:` line");
            return;
          }
          writeFileSync(o.out, `${out.replace(flow[0], "").trimEnd()}\n`);
          writeFileSync(`${o.out}.flow.txt`, `${flow[0].trim()}\n`);
          process.stderr.write(`${flow[0].trim()} (in ${o.out}.flow.txt)\n`);
        };
        params.DRAFT_LABEL = NOUN[prof.kind][0].toUpperCase() + NOUN[prof.kind].slice(1);
      }
      // Fenced, so the text's own headings and last line cannot run into the instruction after it.
      content.DRAFT = fenced(input);
      break;
    }
    default:
      fail(`unknown step "${step}"`);
  }

  const system = render(prompt(step, "system"), params, content, `${step}.system.md`);
  const user = render(prompt(step, "user"), params, content, `${step}.user.md`);
  return { lang, prof, system, user, input, ...hooks };
}

/**
 * The version note is boilerplate copied verbatim, protected like a marker: an answer carries
 * exactly the note it was given, or none when it was given none.
 */
function versionNoteProblems(after, expected) {
  const want = expected && expected !== "none" ? expected : undefined;
  const got = versionNoteOf(splitFrontmatter(after));
  if (got === want) return [];
  if (want === undefined) return [`a version note "> ${got}" that the text given does not carry`];
  return [
    got === undefined
      ? `the version note "> ${want}" is gone`
      : `the version note changed: "> ${got}" (it was "> ${want}")`,
  ];
}

/**
 * What emphasize may not do: change any character but `**` pairs, or leave the spans breaking the
 * emphasis rule (one per section and in the lead, within the cap, in running text only).
 */
function emphasizeProblems(before, after, lang, budgets) {
  const problems = [];
  const bare = (t) => t.replace(/\*\*/g, "").replace(/\s+$/, "").split("\n");
  const a = bare(before);
  const b = bare(after);
  const at = a.findIndex((line, i) => line !== b[i]);
  if (at !== -1 || a.length !== b.length) {
    const i = at !== -1 ? at : Math.min(a.length, b.length);
    problems.push(
      `line ${i + 1} differs once the ** are removed: "${(a[i] ?? "(none)").slice(0, 60)}" became "${(b[i] ?? "(none)").slice(0, 60)}"`,
    );
  }
  const { problems: rules } = emphasisCheck(after, lang, {
    cap: budgets.emphasis.cap,
    requireAll: true,
    strict: true,
    quoted: budgets.quotedLabels,
  });
  for (const p of rules) problems.push(p.n ? `line ${p.n}: ${p.msg}` : p.msg);
  for (const it of parseText(after).items) {
    if (!["text", "list", "quote", "table", "heading"].includes(it.type)) continue;
    for (const msg of flankingProblems(it.line)) problems.push(`line ${it.n}: ${msg}`);
  }
  return [...problems, ...wholeSentenceProblems(after)];
}

/**
 * Each `**` span must hold one whole sentence: it opens where its sentence opens (the paragraph's
 * start, or right after the previous sentence's end punctuation and any markers or closing marks
 * after it) and closes right before the sentence's end punctuation, or at the paragraph's end.
 * Markers and citations may sit between the closing `**` and that punctuation.
 */
function wholeSentenceProblems(text) {
  const doc = parseText(text);
  const tldr = tldrLines(doc.items);
  const problems = [];
  const trailing = /(?:\s|\{[FO]\d+\}|\[\^\d+\])+$/;
  const leading = /^(?:\s|\{[FO]\d+\}|\[\^\d+\])+/;
  for (const p of paragraphs(doc.items.filter((it) => !tldr.has(it.n)))) {
    const masked = p.text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => " ".repeat(m.length));
    for (const m of masked.matchAll(EMPHASIS)) {
      const inner = p.text.slice(m.index + 2, m.index + m[0].length - 2);
      const show = `"${inner.slice(0, 40)}${inner.length > 40 ? "…" : ""}"`;
      const before = p.text
        .slice(0, m.index)
        .replace(trailing, "")
        .replace(/[)）"”’」』\]]+$/, "");
      if (before && !/[.!?。！？]$/.test(before)) {
        problems.push(
          `line ${p.n}: the span ${show} starts in the middle of its sentence; mark the whole sentence, from its first word`,
        );
      }
      const after = p.text.slice(m.index + m[0].length).replace(leading, "");
      if (after && !/^[.!?。！？]/.test(after)) {
        problems.push(
          `line ${p.n}: the span ${show} ends before its sentence does; mark the whole sentence, up to its final punctuation`,
        );
      }
      if (sentences(inner).length > 1) {
        problems.push(`line ${p.n}: the span ${show} holds more than one sentence`);
      }
    }
  }
  return problems;
}

/**
 * A text's blocks, as the transition guard compares them: runs of non-blank lines, each heading a
 * block of its own, fenced code and figure blocks whole. A block's kind is `heading`, `para` (a
 * paragraph of plain text lines), `tldr` (the TL;DR line and its bullets) or `other`.
 */
function blocksOf(text) {
  const doc = parseText(text);
  const tldr = tldrLines(doc.items);
  const blocks = [];
  let cur = null;
  const close = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const it of doc.items) {
    if (it.type === "blank") {
      close();
      continue;
    }
    if (it.type === "heading") {
      close();
      blocks.push({ kind: "heading", h2: /^## /.test(it.line), lines: [it.line], n: it.n });
      continue;
    }
    const kind = tldr.has(it.n) ? "tldr" : it.type === "text" ? "para" : "other";
    if (!cur) cur = { kind, lines: [], n: it.n };
    else if (cur.kind !== kind) cur.kind = "other";
    cur.lines.push(it.line);
  }
  close();
  return { meta: doc.metaRaw, blocks };
}

/**
 * The joins of a text: for every `## ` heading, the paragraph right before it (`before`) and the
 * paragraph right after it (`after`), as block indexes, when those blocks are paragraphs. A TL;DR,
 * list, figure or caption next to a heading is no paragraph, so that side of the join stays.
 */
function joinsOf(blocks) {
  const joins = [];
  blocks.forEach((b, i) => {
    if (b.kind !== "heading" || !b.h2) return;
    joins.push({
      heading: b.lines[0].slice(3).trim(),
      before: blocks[i - 1]?.kind === "para" ? i - 1 : undefined,
      after: blocks[i + 1]?.kind === "para" ? i + 1 : undefined,
    });
  });
  return joins;
}

/** Which sentence of which block transition may rewrite: the first after a heading, the last before one. */
function editableSentences(blocks) {
  const may = new Map();
  const allow = (i, which) => {
    if (i === undefined) return;
    if (!may.has(i)) may.set(i, new Set());
    may.get(i).add(which);
  };
  for (const j of joinsOf(blocks)) {
    allow(j.after, "first");
    allow(j.before, "last");
  }
  return may;
}

const paraSentences = (block) => sentences(block.lines.map((l) => l.trim()).join(" "));

/**
 * What transition may not do: change any block but the paragraphs next to a `## ` heading, any
 * sentence of those but the first after the heading and the last before it, the markers or `**`
 * of a sentence it rewrites, or the number of blocks or sentences.
 */
function transitionProblems(before, after) {
  const a = blocksOf(before);
  const b = blocksOf(after);
  const problems = [];
  if (a.meta !== b.meta) problems.push("the frontmatter changed");
  if (a.blocks.length !== b.blocks.length) {
    problems.push(
      `${b.blocks.length} blocks; the text given had ${a.blocks.length} (a paragraph, heading or figure was added, dropped, split or merged)`,
    );
    return problems;
  }
  const may = editableSentences(a.blocks);
  const name = (x) =>
    x.kind === "heading"
      ? `the heading "${x.lines[0]}"`
      : x.kind === "tldr"
        ? "the TL;DR"
        : FIGURE_OPEN.test(x.lines[0].trim())
          ? `figure block ${figureIdsIn(x.lines.join("\n"))[0] ?? ""}`.trim()
          : `the ${x.kind === "para" ? "paragraph" : "block"} at line ${x.n}`;
  a.blocks.forEach((x, i) => {
    const y = b.blocks[i];
    if (x.lines.join("\n") === y.lines.join("\n")) return;
    const which = may.get(i);
    if (!which || y.kind !== "para") {
      problems.push(
        `${name(x)} changed; transition rewrites only the first sentence after a heading and the last sentence before one`,
      );
      return;
    }
    const sa = paraSentences(x);
    const sb = paraSentences(y);
    if (sa.length !== sb.length) {
      problems.push(`${name(x)} has ${sb.length} sentences; it had ${sa.length}`);
      return;
    }
    sa.forEach((s, k) => {
      const t = sb[k];
      if (s === t) return;
      const role =
        k === 0 && which.has("first")
          ? "first"
          : k === sa.length - 1 && which.has("last")
            ? "last"
            : undefined;
      if (!role) {
        problems.push(
          `${name(x)}: sentence ${k + 1} changed ("${t.slice(0, 60)}"); only its ${[...which].join(" and ")} sentence may`,
        );
        return;
      }
      const ma = (s.match(MARKER) ?? []).join("");
      const mb = (t.match(MARKER) ?? []).join("");
      if (ma !== mb) {
        problems.push(
          `${name(x)}: its ${role} sentence carries ${mb || "no marker"}; it carried ${ma || "none"} (a rewritten sentence keeps its markers in order)`,
        );
      }
      if ((s.match(/\*\*/g) ?? []).length !== (t.match(/\*\*/g) ?? []).length) {
        problems.push(`${name(x)}: its ${role} sentence gained or lost a ** span`);
      }
    });
  });
  return problems;
}

/** Every join, before → after, one line each; then the review that scores the result. */
function transitionReport(before, after, out) {
  const a = blocksOf(before).blocks;
  const b = blocksOf(after).blocks;
  const changed = (i, k) => {
    if (i === undefined) return undefined;
    const sa = paraSentences(a[i]);
    const sb = paraSentences(b[i]);
    const at = k === "first" ? 0 : sa.length - 1;
    return sa[at] === sb[at] ? undefined : `"${sa[at]}" → "${sb[at]}"`;
  };
  const lines = joinsOf(a).map((j) => {
    const parts = [
      ["last before", changed(j.before, "last")],
      ["first after", changed(j.after, "first")],
    ].filter(([, c]) => c);
    const fixed = j.after === undefined ? " (no paragraph after the heading)" : "";
    return `  ## ${j.heading}: ${parts.length ? parts.map(([w, c]) => `${w} ${c}`).join("; ") : `unchanged${fixed}`}`;
  });
  const edited = lines.filter((l) => !/: unchanged/.test(l)).length;
  process.stderr.write(
    `transition: ${edited} of ${lines.length} joins edited\n${lines.join("\n")}\n`,
  );
  note(`next: review --in ${out}; its .flow.txt holds the score (m of m expected)`);
}

/**
 * `draft.en.v3.md` → the next free `draft.en.v<k>.md` beside it, and unstrip's
 * `recovered.en.md` → the first free one; any other name needs --out.
 */
function nextDraftFile(input) {
  const m = /^(?:draft\.(en|zh)\.v\d+|recovered\.(en|zh))\.md$/.exec(path.basename(input));
  if (!m) fail("this step needs --out <file> for an input not named draft.<lang>.vN.md");
  return nextDraftIn(path.dirname(input), m[1] ?? m[2]);
}

/** The next free `draft.<lang>.v<k>.md` in a directory. */
function nextDraftIn(dir, lang) {
  const versions = existsSync(dir)
    ? readdirSync(dir)
        .map((name) => new RegExp(`^draft\\.${lang}\\.v(\\d+)\\.md$`).exec(name)?.[1])
        .filter(Boolean)
        .map(Number)
    : [];
  return path.join(dir, `draft.${lang}.v${Math.max(0, ...versions) + 1}.md`);
}

/**
 * An author's notes for one piece, one per line: `keep[ en|zh]: <exact string>` (an answer without
 * it is refused), `avoid[ en|zh]: <string>` (an answer with it is refused) and `note: <text>`
 * (prompt only). A line tagged with a language applies to that language alone.
 */
function notesOf(file) {
  const out = { keep: [], avoid: [], note: [] };
  for (const line of read(file, "--notes").split("\n")) {
    const m = /^\s*(?:[-*]\s+)?(keep|avoid|note)(?:\s+(en|zh))?\s*:\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]].push({ lang: m[2], text: m[3] });
  }
  return out;
}

/** The notes an answer in this language breaks: a `keep:` string missing, an `avoid:` string present. */
function notesProblems(out, notes, lang) {
  if (!notes) return [];
  const bare = out.replace(MARKER, "").replace(/\*\*/g, "");
  const has = (text) => out.includes(text) || bare.includes(text);
  const mine = (x) => !x.lang || x.lang === lang;
  return [
    ...notes.keep
      .filter((k) => mine(k) && !has(k.text))
      .map((k) => `keep: "${k.text}" is missing; the author's notes ask for it verbatim`),
    ...notes.avoid
      .filter((a) => mine(a) && has(a.text))
      .map((a) => `avoid: "${a.text}" is in the answer; the author's notes rule it out`),
  ];
}

/** A pinned title is written as given, byte for byte. */
function titleProblems(out, title) {
  if (title === undefined) return [];
  const got = splitFrontmatter(out).meta.title;
  return got === title ? [] : [`the title is "${got ?? "(none)"}"; it must be "${title}"`];
}

/**
 * What a whole-piece writer never writes: a footnote (strip makes them), a Sources line, and, where
 * bold is the emphasis, any bold beyond the `**TL;DR**` line (emphasize adds the bold later).
 */
function writeHardProblems(out, budgets) {
  const problems = [];
  const doc = parseText(out);
  for (const it of doc.items) {
    if (["code", "fence", "figure"].includes(it.type)) continue;
    const t = it.line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, "");
    if (/\[\^/.test(t)) problems.push(`line ${it.n}: a footnote [^…] (strip writes the citations)`);
    if (FOOTER.test(t.trim())) problems.push(`line ${it.n}: a Sources line`);
    if (budgets.quotedLabels && !TLDR.test(t.trim()) && /\*\*/.test(t)) {
      problems.push(
        `line ${it.n}: bold outside the **TL;DR** line (emphasize adds the bold later; a UI label goes in quotes)`,
      );
    }
  }
  return problems;
}

/**
 * A whole draft's sizes section by section, against the profile's caps (limits) and the plan's
 * rows (targets), and the page against its cap. Printed after a whole-piece step; returns the
 * sections over a cap and whether the page is over.
 */
function docReport(text, lang, budgets, outline) {
  const lines = [];
  const over = [];
  let total = 0;
  for (const part of splitSections(text)) {
    const sizes = part.n === 0 ? leadCounts(part.text, lang) : { lead: countBody(part.text, lang) };
    total += sizes.lead + (sizes.tldr ?? 0);
    const limit = part.n === 0 ? budgets.lead : budgets.section;
    const planned = plannedSize(
      outline?.rows.find((r) => r.n === part.n),
      outline,
      budgets,
    );
    const isOver = limit && sizes.lead > limit.cap;
    const tldrOver = budgets.tldr && sizes.tldr > budgets.tldr.cap;
    if (isOver || tldrOver) over.push(part.n);
    lines.push(
      `  s${part.n}  ${String(sizes.lead).padStart(4)} ${budgets.unit}` +
        `${planned !== undefined ? ` / plan ${planned}` : ""}${limit ? ` / cap ${limit.cap}` : ""}` +
        `${sizes.tldr !== undefined ? `  TL;DR ${sizes.tldr}${budgets.tldr ? ` / cap ${budgets.tldr.cap}` : ""}` : ""}` +
        `${isOver || tldrOver ? "  OVER" : planned !== undefined && sizes.lead > planned * 1.1 ? "  above plan" : ""}`,
    );
  }
  const cap = budgets.total?.cap;
  const pageOver = cap !== undefined && total > cap;
  lines.push(
    `  page ${total} ${budgets.unit}${cap !== undefined ? ` of at most ${cap}` : ""}${pageOver ? "  OVER" : ""}`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);
  return { over, pageOver, total };
}

/** The numbered items of a findings list, each with its [quoted passage] when it has one. */
function findingItems(text) {
  return text
    .split(/^(?=\s*\d+\.\s)/m)
    .map((s) => s.trim())
    .filter((s) => /^\d+\.\s/.test(s))
    .map((item) => ({ item, quote: /^\d+\.\s*\[([\s\S]+?)\]\s*[—–-]/.exec(item)?.[1] }));
}

/**
 * Whether a finding names a figure: by its id, by a quote found inside its block, or by quoting a
 * passage that holds one of its strings (the prose reuses them, and fix changes both together).
 */
function findingNamesFigure(items, fig, block) {
  const inBlock = locatable(block);
  const strings = [fig.alt, fig.caption, fig.title, ...fig.text.map((t) => t.value)]
    .filter(Boolean)
    .map(locatable)
    .filter((x) => x.length >= 4);
  return items.some(({ item, quote }) => {
    if (item.includes(fig.id)) return true;
    const q = quote ? locatable(quote) : "";
    return q.length >= 3 && (inBlock.includes(q) || strings.some((x) => q.includes(x)));
  });
}

/**
 * What a fix may not do: bring in a fact or opinion id that neither the text it was given nor its
 * findings name; add, drop or reorder a figure; turn a screenshot's block into a drawn one; or
 * change a figure block no finding names.
 */
function fixProblems(before, after, findingsText, { whole = false } = {}) {
  const problems = [];
  const findings = findingItems(findingsText);
  // A whole post keeps its sections, its headings and its title unless a finding names them.
  if (whole) {
    const heads = (t) =>
      parseText(t)
        .items.filter((it) => it.type === "heading" && /^## /.test(it.line))
        .map((it) => it.line.slice(3).trim());
    const a = heads(before);
    const b = heads(after);
    if (a.length !== b.length) {
      problems.push(
        `${b.length} sections; the text given had ${a.length} (a fix never adds or drops a section)`,
      );
    } else {
      a.forEach((h, i) => {
        const named = findings.some(
          ({ item, quote }) =>
            /\bheadings?\b/i.test(item) || (quote && locatable(h).includes(locatable(quote))),
        );
        if (h !== b[i] && !named) {
          problems.push(
            `the heading "${h}" became "${b[i]}", and no finding quotes it or names a heading`,
          );
        }
      });
    }
    const ta = splitFrontmatter(before).meta.title;
    const tb = splitFrontmatter(after).meta.title;
    if (ta !== tb && !findings.some(({ item }) => /\btitle\b/i.test(item))) {
      problems.push(`the title became "${tb}", and no finding names the title`);
    }
  }
  const ids = (t) => new Set((t.match(MARKER) ?? []).map((m) => m.slice(1, -1)));
  const had = ids(before);
  const named = new Set(findingsText.match(/\b[FO]\d+\b/g) ?? []);
  for (const id of ids(after)) {
    if (!had.has(id) && !named.has(id)) {
      problems.push(
        `{${id}} is new: neither the text given to fix nor its findings name ${id}, so the fix added a fact no finding asked for`,
      );
    }
  }
  const was = figureBlockTexts(before);
  const now = figureBlockTexts(after);
  if ([...was.keys()].join() !== [...now.keys()].join()) {
    problems.push(
      `figure blocks [${[...now.keys()].join(", ")}]; the text given had [${[...was.keys()].join(", ")}] (a fix never adds, drops or reorders a figure)`,
    );
  }
  const oldFigs = new Map(parseText(before).figures.map((f) => [f.id, f]));
  const newFigs = new Map(parseText(after).figures.map((f) => [f.id, f]));
  const items = findingItems(findingsText);
  for (const [id, block] of now) {
    const old = was.get(id);
    if (old === undefined || old === block) continue;
    const a = oldFigs.get(id);
    const b = newFigs.get(id);
    if (a && b && !isDrawn(a) && isDrawn(b)) {
      problems.push(
        `figure ${id} is a screenshot's block (alt and caption only), and the answer gave it ${b.text.length ? `${b.text.length} text: string(s)` : "a title"}`,
      );
    } else if (a && !findingNamesFigure(items, a, old)) {
      problems.push(
        `figure ${id} changed, and no finding names it by its id or by quoting its text`,
      );
    }
  }
  return problems;
}

/**
 * Which sections a whole-draft trim cuts, and to what. A section over its profile cap is cut to a
 * little under that cap (TRIM_AIM of it), never to its plan row. When the page is over its cap
 * even after those cuts, what is left over, down to a little under the page cap, is shared among
 * the other sections in proportion to their size. Each named section also gets a floor
 * (TRIM_FLOOR of its target): an answer below it cut too much and is refused.
 */
function trimPlan(text, lang, budgets) {
  const parts = splitSections(text).map((part) => {
    const limit = part.n === 0 ? budgets.lead : budgets.section;
    const sizes = part.n === 0 ? leadCounts(part.text, lang) : { lead: countBody(part.text, lang) };
    return { n: part.n, heading: part.heading, now: sizes.lead, tldr: sizes.tldr ?? 0, limit };
  });
  const named = new Map();
  for (const p of parts) {
    if (p.limit && p.now > p.limit.cap) {
      const cap = p.limit.cap;
      named.set(p.n, {
        now: p.now,
        cap,
        aim: Math.floor(cap * TRIM_AIM),
        floor: Math.floor(cap * TRIM_FLOOR),
        why: "cap",
      });
    }
  }
  const total = parts.reduce((sum, p) => sum + p.now + p.tldr, 0);
  const pageCap = budgets.total?.cap;
  if (pageCap !== undefined && total > pageCap) {
    const cut = [...named.values()].reduce((sum, x) => sum + x.now - x.aim, 0);
    const need = total - Math.floor(pageCap * TRIM_AIM) - cut;
    // The lead states the thesis, so the page's share falls on the sections.
    const rest = parts.filter((p) => p.n > 0 && !named.has(p.n) && p.now > 0);
    const pool = rest.reduce((sum, p) => sum + p.now, 0);
    if (need > 0 && pool > 0) {
      for (const p of rest) {
        const target = p.now - Math.ceil((need * p.now) / pool);
        named.set(p.n, {
          now: p.now,
          cap: p.limit?.cap ?? p.now,
          aim: target,
          floor: Math.floor(target * TRIM_FLOOR),
          why: "page",
        });
      }
    }
  }
  return { named, total, pageCap, headings: parts.map((p) => p.heading) };
}

/**
 * What a whole-draft trim may not do: change a section it was not asked to cut, leave a named
 * section over its cap or the page over its cap, cut a named section below its floor, or change
 * what trim keeps everywhere (markers, footnote references, figure blocks, headings, frontmatter).
 */
function trimDocProblems(before, after, { plan, lang, budgets, where }) {
  const problems = preservedProblems(before, after);
  const a = splitSections(before);
  const b = splitSections(after);
  const named = [...plan.named.keys()].map(where).join(", ");
  if (a.length !== b.length) {
    problems.push(`${b.length - 1} sections after the lead; the draft had ${a.length - 1}`);
    return problems;
  }
  a.forEach((part, i) => {
    if (!plan.named.has(i) && part.text.trimEnd() !== b[i].text.trimEnd()) {
      problems.push(`${where(i)} changed, but trim cuts only ${named}`);
    }
  });
  let total = 0;
  b.forEach((part, i) => {
    const sizes = i === 0 ? leadCounts(part.text, lang) : { lead: countBody(part.text, lang) };
    total += sizes.lead + (sizes.tldr ?? 0);
    const x = plan.named.get(i);
    if (x && sizes.lead > x.cap)
      problems.push(`${where(i)} is still over its cap: ${sizes.lead} > ${x.cap}`);
    else if (x && sizes.lead < x.floor) {
      problems.push(
        `${where(i)} was cut to ${sizes.lead} ${budgets.unit}, below its floor of ${x.floor}: it was to land near ${x.aim}, so the answer cut more than the budget asks`,
      );
    }
  });
  if (plan.pageCap !== undefined && total > plan.pageCap) {
    problems.push(`the page is still over its cap: ${total} ${budgets.unit} > ${plan.pageCap}`);
  }
  return problems;
}

/**
 * Figure blocks a step may not change, copied back from the text it was given: a block the answer
 * rewrote (a screenshot that gained `text:` lines, a string cut short) is replaced by the given
 * block with the same id before the guard runs. A block the answer dropped stays dropped, so the
 * guard still refuses that.
 */
function restoreFigureBlocks(out, input) {
  const given = figureBlockTexts(input);
  let text = out;
  for (const [id, block] of figureBlockTexts(out)) {
    const was = given.get(id);
    if (was === undefined || was === block) continue;
    text = text.replace(block, () => was);
    note(`figure ${id}: the answer changed its block; the block given is kept`);
  }
  return text;
}

/** What trim keeps byte for byte: markers and footnote references in order, figure blocks, headings, frontmatter. */
function preservedProblems(before, after) {
  const problems = [];
  const marks = [
    ["fact markers", MARKER],
    ["footnote references", /\[\^[^\]\s]+\]/g],
  ];
  for (const [what, re] of marks) {
    const a = before.match(re) ?? [];
    const b = after.match(re) ?? [];
    if (a.join() === b.join()) continue;
    const { onlyA: dropped, onlyB: added } = multisetDiff(a, b);
    problems.push(
      dropped.length || added.length
        ? `${what} changed: dropped [${dropped.join(" ")}], added [${added.join(" ")}]`
        : `${what} are in another order: ${b.join(" ")} (was ${a.join(" ")})`,
    );
  }
  const was = figureBlockTexts(before);
  const now = figureBlockTexts(after);
  for (const [id, block] of was) {
    if (!now.has(id)) problems.push(`figure block ${id} was dropped`);
    else if (now.get(id) !== block) problems.push(`figure block ${id} changed`);
  }
  for (const id of now.keys()) if (!was.has(id)) problems.push(`figure block ${id} was added`);
  const sameSet = was.size === now.size && [...was.keys()].every((id) => now.has(id));
  if (sameSet && [...was.keys()].join() !== [...now.keys()].join()) {
    problems.push("the figure blocks are in another order");
  }
  if (splitFrontmatter(before).metaRaw !== splitFrontmatter(after).metaRaw) {
    problems.push("the frontmatter changed");
  }
  const headings = (t) =>
    parseText(t)
      .items.filter((it) => it.type === "heading")
      .map((it) => it.line);
  if (headings(before).join("\n") !== headings(after).join("\n"))
    problems.push("a heading changed");
  // A number the text stated anywhere must still be there: a cut that loses one loses a fact.
  const kept = new Set(numbersOf(parseText(after)));
  const lost = [...new Set(numbersOf(parseText(before)))].filter((x) => !kept.has(x));
  if (lost.length) problems.push(`a number the text stated is gone: ${lost.join(", ")}`);
  return problems;
}

/**
 * What a section trim may not do: stay over its cap, or touch anything but the wording of the body
 * text (preservedProblems).
 */
function trimProblems(before, after, { n, lang, cap, tldrCap, unit }) {
  const problems = [];
  const size = sectionSize(after, n, lang);
  if (size > cap) problems.push(`still over its cap: ${size} ${unit} > ${cap}`);
  const tldr = n === 0 ? leadCounts(after, lang).tldr : undefined;
  if (tldrCap !== undefined && tldr !== undefined && tldr > tldrCap) {
    problems.push(`the TL;DR is still over its cap: ${tldr} ${unit} > ${tldrCap}`);
  }
  return [...problems, ...preservedProblems(before, after)];
}

/**
 * A figure that did not change in the source keeps its frozen translation: when the source
 * section's block equals the frozen source draft's block byte for byte, the frozen target block
 * replaces whatever the model wrote, so an unchanged figure needs no redraw.
 */
function reuseTranslatedFigures(out, source, frozenSource, frozenTarget) {
  const now = figureBlockTexts(source);
  const was = figureBlockTexts(frozenSource);
  const target = figureBlockTexts(frozenTarget);
  const written = figureBlockTexts(out);
  let text = out;
  for (const [id, block] of now) {
    if (was.get(id) === block && target.has(id) && written.has(id)) {
      text = text.replace(written.get(id), () => target.get(id));
      note(`figure ${id}: unchanged in the source, so its frozen translation is kept`);
    }
  }
  return text;
}

/** What the section call's answer must look like; printed, never silently fixed. */
function sectionAfter(out, { n, lang, row, budgets, cap, kinds, file, outline }) {
  const problems = [];
  const sections = splitSections(out);
  const h2 = sections.length - 1;
  if (n === 0) {
    if (!out.startsWith("---\n")) problems.push("the lead does not start with its frontmatter");
    if (h2) problems.push(`the lead carries ${h2} \`## \` heading(s)`);
  } else {
    if (!out.startsWith("## ")) problems.push("the section does not start with its `## ` heading");
    if (h2 !== 1) problems.push(`${h2} \`## \` headings (exactly one)`);
  }
  const ids = figureIdsIn(out);
  const want = row.figures;
  if (ids.join() !== want.join()) {
    problems.push(
      `figure blocks [${ids.join(", ")}]; the plan gives this section [${want.join(", ")}]`,
    );
  }
  for (const fig of parseText(out).figures) {
    for (const p of screenshotProblems(fig, kinds)) problems.push(p.msg);
  }
  if (/\[\^/.test(out)) problems.push("a footnote `[^…]` (citations are generated, not written)");
  if (/^\*\*(Sources|来源)/m.test(out)) problems.push("a Sources line");
  const sizes = n === 0 ? leadCounts(out, lang) : { lead: countBody(out, lang) };
  const count = sizes.lead;
  process.stderr.write(
    `section ${n}: ${count} ${budgets.unit}${cap !== undefined ? ` of at most ${cap}` : ""}${row.budget > 0 ? ` (plan ${row.budget})` : ""}` +
      `${sizes.tldr !== undefined ? `; TL;DR ${sizes.tldr}${budgets.tldr ? ` of at most ${budgets.tldr.cap}` : ""}` : ""}\n`,
  );
  // Size alone goes to trim, which only cuts; anything else is written again.
  const over = [];
  if (cap !== undefined && count > cap) over.push(`over budget: ${count} ${budgets.unit} > ${cap}`);
  if (sizes.tldr !== undefined && !budgets.tldr)
    problems.push("a TL;DR, which this profile does not have");
  if (sizes.tldr !== undefined && budgets.tldr && sizes.tldr > budgets.tldr.cap) {
    over.push(`TL;DR over budget: ${sizes.tldr} ${budgets.unit} > ${budgets.tldr.cap}`);
  }
  for (const p of [...problems, ...over]) note(p);
  if (problems.length) {
    note(`rerun this section with --feedback naming the problems; never edit it by hand (${file})`);
  } else if (over.length) {
    note(
      `size alone: trim --in ${file}${outline ? ` --outline ${outline}` : ""} cuts it without rewriting; never cut it by hand`,
    );
  } else {
    note(
      `next: check --in ${file} --section ${n} --outline <outline> --facts <facts> --figures <manifest>`,
    );
  }
}

/**
 * What a whole-post answer must look like, and the next step; printed, never silently fixed. A
 * wrong shape is written again with --feedback; size alone goes to trim.
 */
function writeAfter(out, { o, lang, budgets, prof }) {
  const problems = [];
  const doc = parseText(out);
  if (doc.metaRaw === null) problems.push("no frontmatter at the top");
  const outline = o.outline ? parseOutline(read(o.outline, "--outline")) : undefined;
  const parts = splitSections(out);
  const h2 = parts.length - 1;
  if (outline?.rows.length && h2 !== outline.rows.length - 1) {
    problems.push(`${h2} sections after the lead; the plan has ${outline.rows.length - 1}`);
  }
  const range = rangeOf(profileSettings(prof).sections);
  if (range && (h2 < range.floor || h2 > range.cap)) {
    problems.push(
      `${h2} sections after the lead; the profile asks for ${range.floor} to ${range.cap}`,
    );
  }
  const ids = figureIdsIn(out);
  if (o.figures) {
    const want = manifestStems(read(o.figures, "--figures"));
    if (ids.join() !== want.join()) {
      problems.push(
        `figure blocks [${ids.join(", ")}]; the manifest gives [${want.join(", ")}], in that order`,
      );
    }
  }
  for (const row of outline?.rows ?? []) {
    const here = parts[row.n] ? figureIdsIn(parts[row.n].text) : [];
    for (const id of row.figures) {
      if (ids.includes(id) && !here.includes(id))
        note(`figure ${id} sits outside section ${row.n}, where its plan row puts it`);
    }
  }
  const kinds = figureKinds(o);
  for (const fig of doc.figures)
    for (const p of screenshotProblems(fig, kinds)) problems.push(p.msg);
  const tldr = doc.items.find((it) => TLDR.test(it.line.trim()));
  if (tldr && !budgets.tldr) problems.push("a TL;DR, which this profile does not have");
  if (!tldr && budgets.tldr) note("no TL;DR after the lead");
  if (tldr) {
    const bullets = [...tldrLines(doc.items)].filter(
      (n) => doc.items.find((it) => it.n === n)?.type === "list",
    );
    if (bullets.length < 3 || bullets.length > 4)
      problems.push(`the TL;DR has ${bullets.length} bullets (three or four)`);
  }
  const sizes = docReport(out, lang, budgets, outline);
  if (o["reuse-figures"]) {
    const was = figureBlockTexts(read(o["reuse-figures"], "--reuse-figures"));
    for (const [id, block] of figureBlockTexts(out)) {
      note(was.get(id) === block ? `figure unchanged: ${id}` : `figure changed: ${id} (redraw it)`);
    }
  }
  for (const p of problems) note(p);
  const plan = o.outline ? ` --outline ${o.outline}` : "";
  if (problems.length) {
    note(
      `shape: rerun write --feedback <these problems> --previous ${o.out}; never edit it by hand`,
    );
  } else if (sizes.over.length || sizes.pageOver) {
    note(`size alone: trim --in ${o.out}${plan} cuts it without rewriting`);
  } else {
    note(
      `next: check --in ${o.out}${plan} --facts <facts> --figures <manifest> --plan-rows advisory`,
    );
  }
}

/** After an outline call: the plan is validated, and a failure writes the feedback for one rerun. */
function validateOutline(out, o, prof, lang) {
  const budgets = budgetsOf(prof, lang, o);
  const facts = o.facts ? loadFacts(o.facts) : undefined;
  const manifest = o.figures ? manifestStems(read(o.figures, "--figures")) : undefined;
  const problems = planProblems(parseOutline(out), budgets, { facts, manifest });
  if (!problems.length) {
    note("plan: within budget, every figure placed once, every id in FACTS");
    return;
  }
  const file = path.join(path.dirname(o.out), "outline-feedback.auto.md");
  writeFileSync(file, planFeedback(problems));
  for (const p of problems) note(`plan: ${p}`);
  process.stderr.write(
    `prose: the plan fails ${problems.length} rule(s); wrote ${file}\n` +
      `  rerun once: outline … --feedback ${file} --previous ${o.out}\n`,
  );
  process.exitCode = 1;
}

function planFeedback(problems) {
  const F = loadFragments();
  return `${F["plan-feedback"]}\n${problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;
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

/**
 * The gateway's URL. PROSE_TEST_GATEWAY points the selftest at its local stand-in and is refused
 * for anything but a loopback address, so the key is never sent anywhere else.
 */
function gatewayUrl() {
  const test = process.env.PROSE_TEST_GATEWAY;
  if (!test) return ENDPOINT;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(test)) {
    fail("PROSE_TEST_GATEWAY must be an http://127.0.0.1:<port>/… URL (the selftest's stand-in)");
  }
  return test;
}

/** node:https rather than fetch: fetch gives up after 300 s without headers, and a reasoning call can take longer. */
function post(key, body, timeoutS) {
  const url = gatewayUrl();
  return new Promise((resolve, reject) => {
    const req = (url.startsWith("http:") ? http : https).request(
      url,
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

/** A raw response is never overwritten: a rerun of the same step gets a timestamped name. */
function freshPath(file) {
  if (!existsSync(file)) return file;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return file.replace(/(\.raw)?\.json$/, `.${stamp}$&`);
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

function unwrapFence(text) {
  const m = /^(`{3,})(?:markdown|md)?\n([\s\S]*)\n\1$/.exec(text.trim());
  return m ? m[2] : text.trim();
}

/**
 * The steps send a text inside a four-backtick fence, and a model sometimes echoes one line of it:
 * a lone opening line at the top or a lone closing line at the bottom. With an odd number of such
 * lines in the answer, the stray one is dropped; a nested fence the text holds itself comes in
 * pairs and stays.
 */
function stripStrayFence(text) {
  const lines = text.split("\n");
  if (lines.filter((l) => /^`{4,}/.test(l)).length % 2 === 0) return text;
  if (/^`{4,}\s*$/.test(lines[lines.length - 1])) lines.pop();
  else if (/^`{4,}(markdown|md)?\s*$/.test(lines[0])) lines.shift();
  else return text;
  note("dropped a stray fence line the answer echoed from the prompt");
  return lines.join("\n").trim();
}

/** Where an answer that breaks its step's rules is kept: beside --out, under a name assemble skips. */
function rejectedPath(out) {
  return out.endsWith(".md") ? out.replace(/\.md$/, ".rejected.md") : `${out}.rejected`;
}

/** A section given to a model fenced, so its own `## ` heading is not read as the prompt's. */
const fenced = (text) => `\`\`\`\`markdown\n${text.trim()}\n\`\`\`\``;

const MARKER = /\{[FO]\d+\}/g;

/** Markers the step added or dropped; translate and polish must do neither, fix only on what it changed. */
function markerDrift(step, before, after) {
  const { onlyA: dropped, onlyB: added } = multisetDiff(
    before.match(MARKER) ?? [],
    after.match(MARKER) ?? [],
  );
  if (!added.length && !dropped.length) return;
  const why =
    step === "fix"
      ? "fine only on sentences a finding changed; read them"
      : "this step must keep markers as they were; send it back through fix or rerun";
  note(`markers changed: added [${added.join(" ")}], dropped [${dropped.join(" ")}] (${why})`);
}

async function callApi(step, o, messages) {
  const key = readKey();
  const request = {
    model: o.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    temperature: Number(o.temperature ?? TEMPERATURE[step] ?? 0.3),
    max_tokens: Number(o["max-tokens"] ?? 32000),
  };
  const timeoutS = Number(o.timeout ?? 1800);
  const body = JSON.stringify(request);
  const rawPath = freshPath(
    o.raw ??
      (o["raw-dir"]
        ? // One raw dir serves every post, so the name carries the post's folder and the step.
          path.join(
            o["raw-dir"],
            `${path.basename(path.dirname(path.resolve(o.out)))}-${step}-${path.basename(o.out)}.raw.json`,
          )
        : `${o.out}.raw.json`),
  );

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

  let out = `${stripStrayFence(unwrapFence(text))}\n`;
  if (messages.transform) out = messages.transform(out);
  mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  // An answer that breaks what its step may not change never becomes the next version.
  const broken = messages.verify ? messages.verify(out) : [];
  if (broken.length) {
    const kept = rejectedPath(o.out);
    writeFileSync(kept, out);
    for (const p of broken) process.stderr.write(`prose: ${step}: ${p}\n`);
    fail(
      `${step}: the answer breaks ${broken.length} rule(s); it is kept as ${kept} and ${o.out} was not written. Next: ${messages.retry}`,
      1,
    );
  }
  writeFileSync(o.out, out);
  process.stderr.write(`wrote ${o.out}\n`);
  if (["translate", "polish", "fix"].includes(step) && messages.input !== undefined) {
    markerDrift(step, messages.input, out);
  }
  const sectionAnswer = step === "section" || sectionOfFile(o.out);
  if (messages.prof.kind !== "landing" && !["outline", "review"].includes(step) && !sectionAnswer) {
    if (!out.startsWith("---\n"))
      note("the answer does not start with frontmatter; run check on it");
  }
  if (messages.after) messages.after(out);
}

// ---------------------------------------------------------------------------
// Document model for the local steps
// ---------------------------------------------------------------------------

const FOOTER = /^\*\*(Sources|来源|参考来源|参考资料)\*\*\s*[:：]/;
const IMAGE_LINE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)\s*$/;
const CAPTION = /^(_[^_\s][^\n]*_|\*[^*\s][^\n]*\*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const HTML_FIGURE = /^<figure\b[^>]*\bclass="[^"]*\bpost-figure\b/;
const TLDR = /^\*\*TL;DR\*\*\s*$/;
const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;
/** A line that only says there is no version note: the prompt's own words copied into the text. */
const STRAY_NOTE =
  /^(>\s*)?[(（]?\s*(no version note|without a version note|无版本说明|没有版本说明|无版本注释|不附版本说明|本文不含版本说明)\s*[.。)）]?\s*$/i;

const FIGURE_OPEN = /^```figure\b(.*)$/;
/** A CommonMark autolink: `<scheme:…>`, `<mailto:…>` among them, or `<name@host>`. A link, not HTML. */
const AUTOLINK =
  /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/g;
/**
 * A bare URL whose sentence ends in a citation, as a marker in a draft or a footnote in a post:
 * strip writes the [^n] right after the URL, and the site's renderer reads it as part of the link.
 */
const BARE_URL_CITED =
  /(?<![<(\w])https?:\/\/[^\s<>]*?[.,;:!?。，；：！？]*\s*(?:\{[FO]\d+\}|\[\^\d+\])/;
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
    // A key is short and lowercase: `box`, `step1`, `config2`, `left column`, `step (a)`.
    const m = /^([a-z][a-z0-9 ()-]*?):\s+(.+)$/.exec(item[1].trim());
    const keyed = m && m[1].length <= 24 && m[1].split(" ").length <= 3;
    fig.text.push({ where: keyed ? m[1] : undefined, value: unquote(keyed ? m[2] : item[1]), n });
    return;
  }
  const kv = SPEC_KEY.exec(line);
  if (kv) {
    const [, key, value] = kv;
    fig.keys.push({ key, n });
    fig.inText = key === "text";
    if (["alt", "caption", "title", "kind"].includes(key)) fig[key] = unquote(value);
    else if (key !== "text") fig.unknown.push({ key, n });
    else if (value.trim()) fig.unknown.push({ key: "text (items go on their own - lines)", n });
    return;
  }
  if (line.trim()) fig.unknown.push({ key: `unparsed line "${line.trim().slice(0, 40)}"`, n });
}

/** A block with strings to draw is a drawn figure; one with alt and caption only is a screenshot. */
function isDrawn(fig) {
  return fig.text.length > 0 || !!fig.title;
}

const SCREENSHOT_KIND = /screenshot|截图|截屏/i;

/**
 * Figure kinds by id, from the `kind` column of the outline's `# Figures` table and of the
 * manifest (which wins). A block alone cannot say it is a screenshot: one that gained `text:`
 * lines reads as drawn.
 */
function figureKinds(o) {
  const kinds = new Map();
  const take = (text) => {
    let col = -1;
    for (const line of text.split("\n")) {
      // A table is a run of `|` lines; its header row names the kind column.
      if (!/^\s*\|/.test(line)) col = -1;
      if (!/^\s*\|/.test(line) || /^\s*\|\s*:?-{3,}/.test(line)) continue;
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.replace(/[`*]/g, "").trim());
      const at = cells.findIndex((c) => /^(kind\b|类型|种类)/i.test(c));
      if (!STEM.test(cells[0])) col = at !== -1 ? at : col;
      else if (col !== -1 && cells[col]) kinds.set(cells[0], cells[col]);
    }
  };
  if (o.outline) take(parseOutline(read(o.outline, "--outline")).parts.Figures ?? "");
  if (o.figures) take(read(o.figures, "--figures"));
  return kinds;
}

/** A figure whose kind is a screenshot: its block holds `alt` and `caption` and nothing else. */
function screenshotProblems(fig, kinds) {
  const kind = kinds?.get(fig.id);
  if (!kind || !SCREENSHOT_KIND.test(kind)) return [];
  const what = `figure ${fig.id} is a screenshot ("${kind}"), whose block holds alt and caption only`;
  const out = [];
  for (const k of fig.keys) {
    if (k.key === "alt" || k.key === "caption") continue;
    const items = k.key === "text" ? ` and ${fig.text.length} string(s) under it` : "";
    out.push({ n: k.n, msg: `${what}; it has a ${k.key}: line${items}` });
  }
  for (const u of fig.unknown.filter((x) => x.key.startsWith("unparsed"))) {
    out.push({ n: u.n, msg: `${what}; it has an ${u.key}` });
  }
  return out;
}

/** A document file, split into typed lines. */
function parseDoc(file) {
  return parseText(read(file, "--in"), file);
}

/** A text split into typed lines with their line numbers; fenced code is opaque. */
function parseText(raw, file) {
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
      fig = { id, n, keys: [], text: [], unknown: [], closed: false, inText: false };
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
    else if (HTML_FIGURE.test(line.trim())) type = "htmlfigure";
    else if (FOOTNOTE_DEF.test(line.trim())) type = "footnote";
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
    [f.title, f.alt, f.caption]
      .filter(Boolean)
      .map((v) => ({ type: "figtext", line: v, n: f.n }))
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

function paragraphs(items) {
  const out = [];
  let cur = null;
  for (const it of items) {
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
    .replace(/https?:\/\/[^\s<>]+/g, (m) => m.replace(/[.!?]/g, "\u0001"))
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
  const sources = new Map();
  for (const line of (factsSection(text, "SOURCES") ?? "").split("\n")) {
    const m = /^\s*[-*]\s*(S\d+)\s*[:：]\s*(.+?)\s*·\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    const where = m[3];
    const url = /^https?:\/\//.test(where) ? where : null;
    const kind = url ? "url" : where === "private" || where === "nolink" ? where : "unknown";
    sources.set(m[1], { id: m[1], title: m[2].trim(), url, kind, raw: where });
  }
  const tags = new Map();
  for (const [id, entry] of factsEntries(factsSection(text, "FACTS"))) {
    const t = /\[((?:S\d+[\s,]*)+)\]\s*$/.exec(entry.trim());
    tags.set(id, t ? t[1].match(/S\d+/g) : []);
  }
  // Facts whose sources are background: the writer still marks them, and they cite nothing.
  const nocite = new Set();
  for (const line of (factsSection(text, "NOCITE") ?? "").split("\n")) {
    const m = /^\s*[-*]\s*((?:\{?F\d+\}?[\s,]*)+)/.exec(line);
    if (m) for (const id of m[1].match(/F\d+/g)) nocite.add(id);
  }
  return { text, ids, urls, terms, sources, tags, nocite };
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
    if (["figure", "htmlfigure", "footnote"].includes(it.type)) continue;
    for (const m of it.line.matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/g)) spans.push(m[2].trim());
  }
  return spans;
}

function urlsOf(doc) {
  const out = [];
  for (const it of doc.items) {
    if (["code", "fence", "image", "htmlfigure"].includes(it.type)) continue;
    for (const m of it.line.matchAll(/https?:\/\/[^\s)<>\]」，。]+/g)) {
      out.push(m[0].replace(/[.,;:]+$/, ""));
    }
  }
  return out;
}

const PROSE_TYPES = ["text", "list", "quote", "table", "heading", "caption", "figtext"];

function numbersOf(doc) {
  const out = [];
  for (const it of [...doc.items, ...figureLines(doc)]) {
    if (!PROSE_TYPES.includes(it.type)) continue;
    const t = maskProse(it.line)
      .replace(MARKER, " ")
      .replace(/\[\^\d+\]/g, " ");
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

function htmlFigureId(line) {
  return /\bdata-figure="([^"]*)"/.exec(line)?.[1];
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

// ---------------------------------------------------------------------------
// Drawn figures: the inline SVG must say exactly what the figure block says
// ---------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    return String.fromCodePoint(
      e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
    );
  });
}

/** Tags dropped, entities decoded, whitespace collapsed. */
/** Typographic quotes as straight ones: strip straightens them in English text. */
function foldQuotes(text) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function plain(html) {
  return foldQuotes(decode(html.replace(/<[^>]*>/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(text) {
  return foldQuotes(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The drawn text of an SVG: every `<tspan>`, and the direct text of every `<text>`. */
function svgLeaves(svg, clean = plain) {
  const leaves = [];
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const inner = m[1];
    for (const t of inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) leaves.push(clean(t[1]));
    const direct = clean(inner.replace(/<tspan\b[\s\S]*?<\/tspan>/g, " "));
    if (direct) leaves.push(direct);
  }
  return leaves.filter(Boolean);
}

/** Every way one inline figure can disagree with its figure block. Returns messages. */
function figureProblems(html, fig, { slug, lang }) {
  const errs = [];
  const figures = html.match(/<figure\b/g) ?? [];
  if (figures.length !== 1) errs.push(`${figures.length} <figure> elements (exactly one)`);
  const open = /<figure\b([^>]*)>/.exec(html);
  if (open) {
    if (!/\bclass="[^"]*\bpost-figure\b[^"]*"/.test(open[1]))
      errs.push('<figure> lacks class="post-figure"');
    const df = /\bdata-figure="([^"]*)"/.exec(open[1])?.[1];
    if (df !== fig.id) errs.push(`data-figure="${df ?? ""}" (the block's id is "${fig.id}")`);
  }
  const start = html.indexOf("<figure");
  const end = html.lastIndexOf("</figure>");
  if (end === -1) errs.push("no </figure>");
  if (start !== -1 && end !== -1 && /\n[ \t]*\n/.test(html.slice(start, end))) {
    errs.push("a blank line inside the figure (it ends the Markdown HTML block)");
  }
  const svg = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/.exec(html);
  if (!svg) {
    errs.push("no <svg>");
    return errs;
  }
  if (!/\brole="img"/.test(svg[1])) errs.push('<svg> lacks role="img"');
  const labelledby = /\baria-labelledby="([^"]*)"/.exec(svg[1])?.[1];
  const title = /<title\b([^>]*)>([\s\S]*?)<\/title>/.exec(svg[2]);
  if (!title) errs.push("no <title> in the <svg>");
  else {
    const tid = /\bid="([^"]*)"/.exec(title[1])?.[1];
    if (!tid || tid !== labelledby) {
      errs.push(
        `aria-labelledby="${labelledby ?? ""}" does not name the <title id="${tid ?? ""}">`,
      );
    }
    if (plain(title[2]) !== normalize(fig.alt))
      errs.push(`<title> is not the block's alt: "${plain(title[2]).slice(0, 60)}"`);
  }
  const prefix = `${slug}-${fig.id}-${lang}`;
  for (const m of html.matchAll(/\bid="([^"]*)"/g)) {
    if (!m[1].startsWith(prefix)) errs.push(`id "${m[1]}" does not start with ${prefix}`);
  }
  const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(html);
  if (!cap) errs.push("no <figcaption>");
  else if (plain(cap[1]) !== normalize(fig.caption))
    errs.push(`<figcaption> is not the block's caption: "${plain(cap[1]).slice(0, 60)}"`);
  const want = fig.text.map((t) => normalize(t.value));
  const ol = /<ol\b[^>]*\bclass="[^"]*\bfig-steps\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/.exec(html);
  if (!ol) {
    if (want.length) errs.push('no <ol class="fig-steps">');
  } else {
    const lis = [...ol[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => plain(m[1]));
    const at = lis.findIndex((li, i) => li !== want[i]);
    if (lis.length !== want.length || at !== -1) {
      const i = at === -1 ? Math.min(lis.length, want.length) : at;
      errs.push(
        `fig-steps differs from the block's text at item ${i + 1}: "${lis[i] ?? "(none)"}" vs "${want[i] ?? "(none)"}"`,
      );
    }
  }
  const leaves = svgLeaves(svg[2]);
  const allowed = new Set([...want, ...(fig.title ? [normalize(fig.title)] : [])]);
  for (const leaf of new Set(leaves)) {
    if (/\p{L}/u.test(leaf) && !allowed.has(leaf))
      errs.push(`drawn text "${leaf.slice(0, 60)}" is not one of the block's strings`);
  }
  const drawn = new Set(leaves);
  for (const s of allowed)
    if (!drawn.has(s))
      errs.push(`block string "${s.slice(0, 60)}" is not drawn as a <text>/<tspan> leaf`);
  return errs;
}

/** The post's slug, for the figure ids: --slug, a `<slug>.<lang>.md` name, or the draft's folder. */
function slugOf(o, file) {
  if (o.slug) return o.slug;
  const m = /^(.+)\.(en|zh)\.md$/.exec(path.basename(file));
  if (m && !/^(draft|outline|findings|recovered)\b/.test(m[1])) return m[1];
  return path.basename(path.dirname(path.resolve(file)));
}

function figureFile(dir, fig, lang) {
  return path.join(dir, `${fig.id}.${lang}.html`);
}

// ---------------------------------------------------------------------------
// check / pair / strip
// ---------------------------------------------------------------------------

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

function checkFrontmatter(doc, lang, prof, o, r) {
  const { meta, metaRaw } = doc;
  if (metaRaw === null) {
    r.add("error", 1, "no frontmatter (--- … ---) at the top");
    return;
  }
  const required =
    prof.kind === "docs" ? ["title", "description"] : ["title", "date", "category", "excerpt"];
  for (const k of required) if (!meta[k]) r.add("error", 1, `frontmatter: missing ${k}`);
  for (const line of metaRaw.split("\n")) {
    const key = line.split(":")[0].trim();
    if (key && !FRONTMATTER_KEYS[prof.kind].includes(key))
      r.add("warn", 1, `frontmatter: unknown key "${key}"`);
    if (
      prof.kind === "post" &&
      (key === "title" || key === "excerpt") &&
      !/^\w+:\s*".*"\s*$/.test(line)
    ) {
      r.add("warn", 1, `frontmatter: ${key} is not double-quoted`);
    }
    if (/\\"/.test(line))
      r.add("error", 1, `frontmatter: \\" is not unescaped by the site's parser (${key})`);
  }
  if (metaRaw.match(MARKER)) r.add("error", 1, "frontmatter carries a fact marker");
  if (prof.kind !== "post") return;
  if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date))
    r.add("error", 1, `frontmatter: date "${meta.date}" is not YYYY-MM-DD`);
  if (meta.category && meta.category !== prof.category) {
    r.add("error", 1, `frontmatter: category "${meta.category}" but the profile is ${prof.name}`);
  }
  if (meta.excerpt) {
    const size =
      lang === "zh"
        ? meta.excerpt.replace(/\s/g, "").length
        : meta.excerpt.split(/\s+/).filter(Boolean).length;
    const cap = lang === "zh" ? 90 : 60;
    if (size > cap)
      r.add("warn", 1, `excerpt is ${size} ${lang === "zh" ? "characters" : "words"} (cap ${cap})`);
  }
  const note = o["version-note"];
  const first = doc.items.find((it) => it.type !== "blank");
  if (note && note !== "none" && (!first || first.line.trim() !== `> ${note}`)) {
    r.add("error", first?.n, `the first body line is not the version note "> ${note}"`);
  }
}

function checkFigures(doc, lang, prof, o, r, secN) {
  const { items } = doc;
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
  // What a block cannot say about itself: whether the manifest or the outline calls it a screenshot.
  const kinds = figureKinds(o);
  for (const fig of doc.figures) {
    for (const p of screenshotProblems(fig, kinds)) r.add("error", p.n, p.msg);
    const kind = kinds.get(fig.id);
    if (kind && !SCREENSHOT_KIND.test(kind) && !isDrawn(fig)) {
      r.add(
        "warn",
        fig.n,
        `figure ${fig.id} is "${kind}", and its block has no title or text: strings, so strip would publish it as a screenshot`,
      );
    }
  }
  if (o.figures && doc.figures.length && !figureKinds({ figures: o.figures }).size) {
    r.add(
      "warn",
      null,
      `${o.figures} has no kind column, so a screenshot's block cannot be told from a drawn one`,
    );
  }
  for (const it of items.filter((x) => x.type === "figure")) {
    if (it.line.match(MARKER)) r.add("error", it.n, "fact marker inside a figure block");
  }

  // Screenshots as image lines (a stripped post) and drawn figures inline.
  const imgs = images(doc);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === "htmlfigure") {
      if (!/<\/figure>\s*$/.test(it.line))
        r.add("error", it.n, "an inline figure must be one line ending in </figure>");
      continue;
    }
    if (it.type !== "image") {
      if (!["code", "figure"].includes(it.type) && /!\[[^\]]*\]\(/.test(it.line)) {
        r.add("error", it.n, "an image inside a paragraph (images stand on their own line)");
      }
      continue;
    }
    const img = imgs.find((x) => x.n === it.n);
    if (!img.alt.trim()) r.add("error", it.n, "image without alt text");
    if (img.alt.match(MARKER)) r.add("error", it.n, "fact marker in alt text");
    if (!img.src.startsWith("/blog-assets/"))
      r.add("error", it.n, `image path "${img.src}" is not /blog-assets/<name>`);
    else if (!img.lang) r.add("error", it.n, `image path "${img.src}" has no -en/-zh suffix`);
    else if (img.lang !== lang)
      r.add("error", it.n, `image path "${img.src}" carries -${img.lang} in a ${lang} text`);
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
  const inline = items.filter((it) => it.type === "htmlfigure");
  if (doc.figures.length && (imgs.length || inline.length)) {
    r.add(
      "warn",
      null,
      "figure blocks and published figures in one file (a draft holds blocks; strip publishes them)",
    );
  }

  if (secN !== undefined && o.outline) {
    const row = parseOutline(read(o.outline, "--outline")).rows.find((x) => x.n === secN);
    const ids = doc.figures.map((f) => f.id).filter(Boolean);
    if (!row) r.add("error", null, `the outline's plan has no row ${secN}`);
    else {
      for (const id of ids) {
        if (!row.figures.includes(id))
          r.add("error", null, `figure ${id} is not in row ${secN} of the plan`);
      }
      for (const id of row.figures) {
        if (!ids.includes(id))
          r.add("error", null, `figure ${id} belongs to this section and has no block`);
      }
    }
  }
  if (o.figures && secN !== undefined) {
    const want = manifestStems(read(o.figures, "--figures"));
    for (const f of doc.figures) {
      if (f.id && !want.includes(f.id))
        r.add("error", f.n, `figure ${f.id} is not in the manifest`);
    }
  } else if (o.figures) {
    const want = manifestStems(read(o.figures, "--figures"));
    if (!want.length)
      r.add(
        "error",
        null,
        `no figure stems in ${o.figures} (a table whose first column is the stem, or id: <stem> lines)`,
      );
    const have = doc.figures
      .map((f) => f.id)
      .concat(
        inline.map((it) => htmlFigureId(it.line)),
        imgs.map((im) => im.stem),
      )
      .filter(Boolean);
    for (const stem of want)
      if (!have.includes(stem))
        r.add("error", null, `figure ${stem} is in the manifest but not in the text`);
    for (const stem of have)
      if (!want.includes(stem)) r.add("error", null, `figure ${stem} is not in the manifest`);
    const order = have.filter((s) => want.includes(s));
    if (order.join() !== want.filter((s) => have.includes(s)).join()) {
      r.add("error", null, `figures are out of manifest order: ${order.join(", ")}`);
    }
  }

  const slug = slugOf(o, doc.file);
  // A draft: each drawn block against its drawn file.
  if (o.svg) {
    for (const fig of doc.figures.filter((f) => f.id)) {
      const file = figureFile(o.svg, fig, lang);
      if (!isDrawn(fig)) {
        if (o.assets) {
          const found = ["png", "jpg"].some((ext) =>
            existsSync(path.join(o.assets, `${fig.id}-${lang}.${ext}`)),
          );
          if (!found)
            r.add("error", fig.n, `screenshot ${fig.id}-${lang}.png/.jpg not found under --assets`);
        } else
          r.add(
            "warn",
            fig.n,
            `figure ${fig.id} is a screenshot (alt and caption only); pass --assets to check its file`,
          );
        continue;
      }
      if (!existsSync(file)) {
        r.add("error", fig.n, `figure ${fig.id} has strings to draw and no ${file}`);
        continue;
      }
      for (const p of figureProblems(read(file), fig, { slug, lang }))
        r.add("error", fig.n, `${path.basename(file)}: ${p}`);
    }
  }
  // A stripped post: each inline figure against the draft's block.
  if (o.draft) {
    const draft = parseDoc(o.draft);
    const drawnBlocks = draft.figures.filter(isDrawn);
    const ids = inline.map((it) => htmlFigureId(it.line));
    if (ids.join() !== drawnBlocks.map((f) => f.id).join()) {
      r.add(
        "error",
        null,
        `inline figures [${ids.join(", ")}] differ from the draft's drawn blocks [${drawnBlocks.map((f) => f.id).join(", ")}]`,
      );
    }
    for (const it of inline) {
      const fig = drawnBlocks.find((f) => f.id === htmlFigureId(it.line));
      if (!fig) continue;
      for (const p of figureProblems(it.line, fig, { slug: slugOf(o, doc.file), lang }))
        r.add("error", it.n, p);
    }
    const shots = draft.figures.filter((f) => !isDrawn(f)).map((f) => f.id);
    if (imgs.map((im) => im.stem).join() !== shots.join()) {
      r.add(
        "error",
        null,
        `screenshots [${imgs.map((im) => im.stem).join(", ")}] differ from the draft's screenshot blocks [${shots.join(", ")}]`,
      );
    }
  }
}

/**
 * Each `**` in a line that CommonMark cannot read as emphasis, so the page shows the asterisks. A
 * closing run needs no whitespace before it, and after punctuation it needs whitespace or
 * punctuation after it (`**关键句。**后文` fails, `**关键句**。后文` renders); an opening run is the
 * mirror image (`a**(note)**` fails). Runs alternate open and close; code spans are skipped.
 */
function flankingProblems(line) {
  const code = [...line.matchAll(/(`+)[\s\S]*?[^`]\1(?!`)/g)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const space = (c) => c === undefined || /\s/u.test(c);
  const punct = (c) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
  const out = [];
  let opening = true;
  for (const m of line.matchAll(/\*\*/g)) {
    if (code.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const prev = line[m.index - 1];
    const next = line[m.index + 2];
    const around = line.slice(Math.max(0, m.index - 8), m.index + 10);
    if (opening && (space(next) || (punct(next) && !space(prev) && !punct(prev)))) {
      out.push(`a ** that cannot open emphasis, so the page shows it: "${around}"`);
    } else if (!opening && (space(prev) || (punct(prev) && !space(next) && !punct(next)))) {
      out.push(
        `a ** that cannot close emphasis, so the page shows it: "${around}" (close it before the punctuation: **句子**。)`,
      );
    }
    opening = !opening;
  }
  return out;
}

/** The line numbers of a text's TL;DR: the `**TL;DR**` line and the list under it. */
function tldrLines(items) {
  const out = new Set();
  let inside = false;
  for (const it of items) {
    if (TLDR.test(it.line.trim())) inside = true;
    else if (inside && it.type !== "blank" && it.type !== "list") inside = false;
    if (inside) out.add(it.n);
  }
  return out;
}

/** A sentence longer than this is flagged: English words, Chinese characters. */
const SENTENCE_CAP = { en: 35, zh: 60 };
const EMPHASIS = /\*\*([^*\n]+?)\*\*/g;

/**
 * The `**…**` spans of a text by section (0 is the lead), and every rule they break: at most one
 * per section (exactly one with `requireAll`), at most `cap` words or characters, never in a
 * heading, figure block, caption, version note, TL;DR, code span or link, and no marker inside;
 * the closing `**` before the sentence's punctuation, so its citation can stand there too.
 */
function emphasisCheck(text, lang, { cap, requireAll = false, strict = false, quoted = false }) {
  const doc = parseText(text);
  const problems = [];
  const add = (n, msg, level = "error") => problems.push({ n, msg, level });
  const spans = [[]];
  const unit = lang === "zh" ? "characters" : "words";
  const first = doc.items.find((it) => it.type !== "blank");
  let inTldr = false;
  for (const it of doc.items) {
    if (it.type === "heading" && /^## /.test(it.line)) spans.push([]);
    if (TLDR.test(it.line.trim())) {
      inTldr = true;
      continue;
    }
    const has = it.line.includes("**");
    if (inTldr && (it.type === "blank" || it.type === "list")) {
      if (has) add(it.n, "emphasis inside the TL;DR");
      continue;
    }
    inTldr = false;
    if (!has || ["code", "fence", "comment"].includes(it.type)) continue;
    if (it.type === "heading") add(it.n, "emphasis in a heading");
    else if (["figure", "htmlfigure"].includes(it.type)) add(it.n, "emphasis in a figure");
    else if (["caption", "image"].includes(it.type)) add(it.n, "emphasis in a caption");
    else if (it === first && VERSION_NOTE_LINE.test(it.line.trim()))
      add(it.n, "emphasis in the version note");
    if (
      !["text", "list", "quote", "table"].includes(it.type) ||
      (it === first && VERSION_NOTE_LINE.test(it.line.trim()))
    )
      continue;
    // Code spans keep their length, so a span's offsets read the original line.
    const masked = it.line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => " ".repeat(m.length));
    if ((masked.match(/\*\*/g)?.length ?? 0) % 2) add(it.n, "an unclosed **");
    if (/\[[^\]]*\*\*[^\]]*\]\(/.test(masked)) add(it.n, "emphasis inside a link");
    for (const m of masked.matchAll(EMPHASIS)) {
      const inner = it.line.slice(m.index + 2, m.index + m[0].length - 2);
      spans[spans.length - 1].push({ n: it.n, text: inner });
      if (/\{[FO]\d+\}|\[\^/.test(inner))
        add(it.n, "a fact marker inside the emphasis (it goes after the closing **)");
      if (/\]\(|<https?:/.test(inner)) add(it.n, "a link inside the emphasis");
      const size = countBody(inner, lang);
      if (cap && size > cap) add(it.n, `an emphasized span of ${size} ${unit} (at most ${cap})`);
      const after = it.line.slice(m.index + m[0].length);
      // emphasize closes every span before the sentence's punctuation (**句子**。, **claim**.):
      // after Chinese punctuation a closing ** often cannot close, and a citation lands outside.
      if (/[.!?。！？]$/.test(inner) && (strict || /^\s*\{[FO]\d+\}/.test(after))) {
        add(
          it.n,
          "the closing ** follows the sentence's punctuation; close the span before it (**sentence**. / **句子**。)",
          strict ? "error" : "warn",
        );
      }
    }
  }
  spans.forEach((list, i) => {
    const where = i === 0 ? "the lead" : `section ${i}`;
    if (list.length > 1 && quoted) {
      add(
        list[1].n,
        `${list.length} bold spans in ${where}: bold marks the one key sentence, so write a UI label in quotes ("…" / 「…」)`,
      );
    } else if (list.length > 1) {
      add(list[1].n, `${list.length} emphasized spans in ${where} (exactly one)`);
    } else if (!list.length && requireAll)
      add(null, `no emphasized sentence in ${where} (exactly one)`);
  });
  return { spans, problems };
}

/**
 * Citation count and placement, read in the published form: a post's own lines, or a draft's lines
 * rendered the way strip's citer will render them (with --facts). A paragraph or a sentence with
 * two citations is an error, and so is a post citing more sources than the profile's `sources`
 * cap; fewer than its floor is a warning. `sources` is undefined for one section of a piece.
 */
function checkCitations(doc, lang, r, facts, { sources } = {}) {
  const draft = !!doc.raw.match(MARKER);
  if (draft && !facts?.sources.size) return;
  const cite = draft ? citations(facts) : undefined;
  const summary = tldrLines(doc.items);
  const starts = paragraphStarts(doc.items);
  const prose = ["text", "list", "quote", "table"];
  // Every item stays, so blank lines and headings still end paragraphs; the TL;DR is set apart.
  const rendered = doc.items.map((it) => {
    if (cite && starts.has(it.n)) cite.paragraph();
    if (summary.has(it.n)) {
      if (!draft && prose.includes(it.type) && /\[\^\d+\]/.test(it.line)) {
        r.add(
          "error",
          it.n,
          "a citation in the TL;DR: it sums up the body, which carries the citations",
        );
      }
      return { ...it, type: "tldr" };
    }
    if (!prose.includes(it.type)) return it;
    return { ...it, line: cite ? cite.render(it.line) : it.line };
  });
  const lines = rendered.filter((it) => prose.includes(it.type));
  const count = (text) => text.match(/\[\^\d+\]/g)?.length ?? 0;
  for (const p of paragraphs(rendered)) {
    const k = count(p.text);
    if (k > 1) {
      r.add(
        "error",
        p.n,
        `a paragraph with ${k} citations (one per paragraph at most): "${p.text.slice(0, 60)}…"`,
      );
    }
    for (const s of sentences(p.text)) {
      if (count(s) > 1)
        r.add(
          "error",
          p.n,
          `a sentence with ${count(s)} citations (one per sentence at most): "${s.slice(0, 60)}…"`,
        );
    }
  }
  for (const it of lines.filter((x) => x.type === "table")) {
    if (count(it.line) > 1) r.add("error", it.n, `a table row with ${count(it.line)} citations`);
  }
  if (sources) {
    const n = draft ? cite.cited() : doc.items.filter((it) => it.type === "footnote").length;
    const what = draft ? "strip would cite" : "the post cites";
    if (n > sources.cap) {
      r.add(
        "error",
        null,
        `${what} ${n} sources; the profile allows at most ${sources.cap}: list the facts a reader need not check under ## NOCITE`,
      );
    } else if (n < sources.floor) {
      r.add("warn", null, `${what} ${n} sources, below the profile's floor of ${sources.floor}`);
    }
  }
  const after = new RegExp(`[${TERMINATOR}]\\[\\^\\d+\\]`);
  const outside = new RegExp(`[.!?。！？](?:[)）"”’」』\\]_]|\\*{1,2})+\\[\\^\\d+\\]`);
  for (const it of lines) {
    if (after.test(it.line)) {
      r.add(
        "error",
        it.n,
        "a citation after the punctuation: it goes before it (text[^1]. / 文字[^1]。); strip the draft again",
      );
    } else if (outside.test(it.line)) {
      r.add(
        "warn",
        it.n,
        "a citation after a closing quote, bracket or bold that holds the sentence's punctuation: put the punctuation outside it, so the citation can stand before it",
      );
    }
  }
}

/** The language rules: the style file's patterns, then the counted ones. */
function languageRules(lang, proseItems, paras, sections, settings, r) {
  const pats = loadPatterns(lang);
  for (const it of proseItems) {
    const t = maskProse(it.line, { quotes: true }).replace(MARKER, "");
    for (const level of ["error", "warn"]) {
      for (const p of pats[level]) {
        const m = p.re.exec(t);
        if (m) r.add(level, it.n, `${p.label}: "${m[0].trim().slice(0, 50)}"`);
      }
    }
  }
  const allowedBangs = Number(settings.exclamations ?? 0);
  const bangLines = proseItems.filter((it) =>
    /[!！](?!\[)/.test(maskProse(it.line).replace(/!\[[^\]]*\]\([^)]*\)|\[![A-Z]+\]/g, "")),
  );
  if (bangLines.length > allowedBangs) {
    for (const it of bangLines)
      r.add(
        "error",
        it.n,
        lang === "zh" ? "感叹号" : `exclamation mark (the profile allows ${allowedBangs})`,
      );
  }

  if (lang === "en") {
    for (const sec of sections) {
      const dashes = sec.items
        .filter((it) => ["text", "list", "quote"].includes(it.type))
        .reduce(
          (sum, it) => sum + (maskProse(it.line, { quotes: true }).match(/—/g)?.length ?? 0),
          0,
        );
      if (dashes > 1)
        r.add(
          "error",
          sec.n ?? sec.items[0]?.n,
          `${dashes} em dashes in one section (at most one)`,
        );
    }
    for (const it of proseItems) {
      const t = maskProse(it.line, { quotes: true }).replace(MARKER, "");
      if (/\S—|—\S/.test(t)) r.add("error", it.n, "unspaced em dash (write ` — `)");
      if (/\w\s--\s\w/.test(t)) r.add("warn", it.n, "double hyphen used as a dash");
    }
    for (const p of paras) {
      const ss = sentences(p.text);
      if (ss.length > 4) r.add("warn", p.n, `a paragraph of ${ss.length} sentences (at most four)`);
      let shortRun = 0;
      for (const s of ss) {
        const words = maskProse(s).replace(MARKER, "").split(/\s+/).filter(Boolean).length;
        shortRun = words <= 3 ? shortRun + 1 : 0;
        if (shortRun === 3) r.add("warn", p.n, "three very short sentences in a row");
        if (words > SENTENCE_CAP.en) {
          r.add(
            "warn",
            p.n,
            `a sentence of ${words} words (at most ${SENTENCE_CAP.en}): "${s.slice(0, 60)}…"`,
          );
        }
      }
    }
    for (const sec of sections) {
      const first = paragraphs(sec.items)[0];
      const s = first ? sentences(first.text)[0] : undefined;
      if (s && /\?["”’)]*\s*(\{[FO]\d+\})*$/.test(s))
        r.add("warn", first.n, "a section opens with a question");
    }
    const words = paras
      .flatMap((p) => sentences(p.text))
      .map((s) => maskProse(s).replace(MARKER, "").split(/\s+/).filter(Boolean).length);
    const avg = words.length ? words.reduce((a, b) => a + b, 0) / words.length : 0;
    if (avg > 20)
      r.add("warn", null, `average sentence length ${avg.toFixed(1)} words (aim under 20)`);
    return;
  }

  const spacing = new RegExp(`[${CJK}][A-Za-z0-9]|[A-Za-z0-9][${CJK}]`);
  const codeFlush = new RegExp(`[${CJK}]\`|\`[${CJK}]`);
  for (const it of proseItems) {
    const t = maskProse(it.line).replace(MARKER, "").replace(/⟦\w+⟧/g, " ");
    if (/——|—/.test(t)) r.add("error", it.n, "破折号");
    if (/"/.test(maskProse(it.line))) r.add("error", it.n, "中文正文里的英文引号");
    if (codeFlush.test(it.line)) r.add("error", it.n, "代码与中文之间缺半角空格");
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
    for (const s of ss) {
      const chars = countBody(s, "zh");
      if (chars > SENTENCE_CAP.zh) {
        r.add(
          "warn",
          p.n,
          `一句 ${chars} 字（最多 ${SENTENCE_CAP.zh} 字）：「${s.slice(0, 30)}…」`,
        );
      }
    }
    if (ss.filter((s) => /^它/.test(s)).length > 1) r.add("warn", p.n, "「它」开头的句子连用");
    const zhe = ss.filter((s) => /^这/.test(s)).length;
    if (zhe > 1) r.add("warn", p.n, `${zhe} 个句子以「这」开头`);
  }
}

function sectionsOf(items) {
  const sections = [{ n: null, items: [] }];
  for (const it of items) {
    if (it.type === "heading") sections.push({ n: it.n, items: [] });
    else sections[sections.length - 1].items.push(it);
  }
  return sections;
}

function checkDoc(doc, lang, prof, o, r, facts) {
  const { items } = doc;
  const settings = profileSettings(prof);
  const post = prof.kind === "post";
  // One section of a piece: s<n>.<lang>.v<k>.md, or --section <n>.
  const secN = o.section !== undefined ? Number(o.section) : sectionOfFile(doc.file)?.n;
  const content = items.filter((it) => it.type !== "blank");
  if (secN === undefined || secN === 0) checkFrontmatter(doc, lang, prof, o, r);
  else if (doc.metaRaw !== null)
    r.add("error", 1, `section ${secN} carries frontmatter (only the lead does)`);
  if (secN !== undefined) {
    const h2s = items.filter((it) => it.type === "heading" && it.line.startsWith("## "));
    if (secN === 0 && h2s.length) r.add("error", h2s[0].n, "the lead carries a `## ` heading");
    if (secN > 0) {
      if (content[0]?.type !== "heading" || !content[0].line.startsWith("## ")) {
        r.add("error", content[0]?.n, `section ${secN} does not start with its \`## \` heading`);
      }
      if (h2s.length !== 1)
        r.add("error", null, `section ${secN} has ${h2s.length} \`## \` headings (exactly one)`);
    }
  }

  // Lead and TL;DR
  const firstNonNote = content.find(
    (it) => !(it.type === "quote" && VERSION_NOTE_LINE.test(it.line.trim())),
  );
  if (
    secN === undefined &&
    (settings.lead ?? "yes") === "yes" &&
    firstNonNote?.type === "heading"
  ) {
    r.add("error", firstNonNote.n, "no lead paragraph before the first heading");
  }
  const tldr = items.find((it) => TLDR.test(it.line.trim()));
  if (tldr && settings.tldr !== "yes")
    r.add("error", tldr.n, `a **TL;DR** line, which profile ${prof.name} does not allow`);
  if (tldr) {
    const firstHeading = items.find((it) => it.type === "heading");
    if (firstHeading && firstHeading.n < tldr.n)
      r.add("error", tldr.n, "the TL;DR comes after the first heading (it follows the lead)");
    const bullets = [];
    for (const it of items.filter((x) => x.n > tldr.n)) {
      if (it.type === "blank" && !bullets.length) continue;
      if (it.type !== "list") break;
      bullets.push(it);
    }
    if (bullets.length < 3 || bullets.length > 4)
      r.add("error", tldr.n, `the TL;DR has ${bullets.length} bullets (three or four)`);
  }

  // An essay's body is prose: `body-lists: none` makes a list outside the TL;DR an error, and
  // `body-tables: none` a Markdown table. Figure blocks and code are not body text.
  const summary = tldrLines(items);
  let prevType = null;
  for (const it of items) {
    if (it.type === "blank") continue;
    const opens = it.type !== prevType;
    prevType = it.type;
    if (!opens) continue;
    if (it.type === "list" && settings["body-lists"] === "none" && !summary.has(it.n)) {
      r.add(
        "error",
        it.n,
        `a list in the body: profile ${prof.name} writes the body in paragraphs, and the TL;DR is its only list`,
      );
    }
    if (it.type === "table" && settings["body-tables"] === "none") {
      r.add(
        "error",
        it.n,
        `a table in the body: profile ${prof.name} puts numbers in sentences, with a figure confirming them`,
      );
    }
  }

  // Headings
  const h2 = items.filter((it) => it.type === "heading" && it.line.startsWith("## "));
  for (const it of items.filter((x) => x.type === "heading")) {
    const level = HEADING.exec(it.line)[1].length;
    if (level === 1) r.add("error", it.n, "an H1 in the body (the title lives in the frontmatter)");
    if (level >= 3 && post)
      r.add("error", it.n, `"${"#".repeat(level)}" heading (only ## is allowed)`);
    if (
      /^#+\s+(\d+[.)、:]|[一二三四五六七八九十]+[、.．]|(step|part|section) \d+\b)/i.test(it.line)
    ) {
      r.add("error", it.n, "numbered heading");
    }
    if (it.line.match(MARKER)) r.add("error", it.n, "fact marker in a heading");
  }
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(settings.sections ?? "");
  if (
    secN === undefined &&
    range &&
    (h2.length < Number(range[1]) || h2.length > Number(range[2]))
  ) {
    r.add(
      "error",
      null,
      `${h2.length} sections (## headings); profile ${prof.name} asks for ${range[1]} to ${range[2]}`,
    );
  }
  if (post) {
    const colonHeads = h2.filter((it) => /[:：]/.test(it.line));
    if (colonHeads.length > 1)
      r.add(
        "error",
        colonHeads[1].n,
        `${colonHeads.length} headings contain a colon (at most one)`,
      );
  }

  checkFigures(doc, lang, prof, o, r, secN);
  const sizes =
    prof.kind !== "landing" ? checkBudgets(doc, lang, prof, o, r, { section: secN }) : undefined;

  // The old Sources footer and its rule; citations are footnotes generated from the markers now.
  for (const it of items.filter((x) => x.type === "footer")) {
    r.add(
      "error",
      it.n,
      "a **Sources** footer: citations are generated from the fact markers by strip",
    );
  }
  if (post) {
    for (const it of items.filter((x) => x.type === "rule"))
      r.add("error", it.n, "horizontal rule");
  }
  // A model's note (omitted / not applied / figure changed) may close any section.
  for (const it of items.filter((x) => x.type === "comment")) {
    const isNote = /^<!--\s*(omitted|not applied|figure changed)\b/.test(it.line.trim());
    const rest = items.filter((x) => x.n > it.n && x.type !== "blank" && x.type !== "comment");
    if (isNote) r.add("warn", it.n, `model note: ${it.line.trim()}`);
    else if (rest.length) r.add("error", it.n, "HTML comment inside the text");
    else if (it.line.trim().startsWith("<!--"))
      r.add("warn", it.n, `model note: ${it.line.trim()}`);
  }
  for (const it of items.filter((x) => ["text", "quote"].includes(x.type))) {
    if (STRAY_NOTE.test(it.line.trim())) {
      r.add("error", it.n, `a stray "${it.line.trim()}" line: an instruction copied as text`);
    }
  }
  checkFootnotes(doc, o, r, facts);
  if (post) {
    checkCitations(doc, lang, r, facts, {
      sources: secN === undefined ? rangeOf(settings.sources) : undefined,
    });
  }
  if (facts && doc.raw.match(MARKER)) checkSources(doc, r, facts);
  const footer = undefined;

  // Forbidden syntax. A figure block's strings are data the drawer escapes, not Markdown or
  // HTML of the post, so only the rules about the words themselves apply to them.
  for (const it of items) {
    if (["code", "fence", "comment", "htmlfigure", "footnote"].includes(it.type)) continue;
    const data = it.type === "figure";
    const t = it.line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, "");
    if (!data && post && /\]\(#/.test(t)) r.add("error", it.n, "in-page anchor link ](#…)");
    if (!data && /^\s*:::/.test(t)) r.add("error", it.n, "callout syntax :::");
    if (!data && /<\/?[a-zA-Z][^>]*>/.test(t.replace(AUTOLINK, " ")))
      r.add("error", it.n, "raw HTML (the only HTML a post may hold is a one-line inline figure)");
    if (!data && BARE_URL_CITED.test(t)) {
      r.add(
        "error",
        it.n,
        "a bare URL right before a citation: the site's renderer takes the citation into the link, so write the URL as an autolink, <https://…>",
      );
    }
    if (!data) for (const msg of flankingProblems(it.line)) r.add("error", it.n, msg);
    if (EMOJI.test(t)) r.add("error", it.n, "emoji");
    if (/\{\{[A-Z_]+\}\}/.test(t))
      r.add("error", it.n, "an unfilled template slot leaked into the text");
    if (post && it.type === "table" && !/^\s*\|\s*:?-{3,}/.test(it.line)) {
      const cols = it.line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|").length;
      if (cols > 4) r.add("error", it.n, `table row with ${cols} columns (at most 4)`);
    }
  }
  if (doc.unclosedFence) r.add("error", null, "unbalanced code fence");

  if (post) {
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
    const budgets = budgetsOf(prof, lang, o);
    if (budgets.emphasis) {
      // A draft before emphasize has no span at all; a published post, or a draft that has some,
      // has one in every section. A section file is never emphasized on its own.
      const rule = { cap: budgets.emphasis.cap, quoted: budgets.quotedLabels };
      const found = emphasisCheck(doc.raw, lang, rule);
      const requireAll =
        secN === undefined && (!doc.raw.match(MARKER) || found.spans.some((x) => x.length));
      const { problems } = requireAll
        ? emphasisCheck(doc.raw, lang, { ...rule, requireAll })
        : found;
      for (const p of problems) r.add(p.level, p.n, p.msg);
    } else if (budgets.quotedLabels) {
      for (const it of items.filter((x) => ["text", "list", "quote"].includes(x.type))) {
        if (!TLDR.test(it.line.trim()) && /\*\*[^*]+\*\*/.test(it.line)) {
          r.add(
            "error",
            it.n,
            'bold in a post that quotes UI labels: write the label in quotes ("…" / 「…」)',
          );
        }
      }
    } else {
      const bolds = items
        .filter((it) => ["text", "list", "quote"].includes(it.type) && !TLDR.test(it.line.trim()))
        .reduce((sum, it) => sum + (it.line.match(/\*\*[^*]+\*\*/g)?.length ?? 0), 0);
      if (bolds > 4)
        r.add(
          "warn",
          null,
          `${bolds} bold spans (bold only UI labels and product names on first mention)`,
        );
    }
  }

  // Markers
  const used = new Set();
  for (const it of items) for (const m of it.line.matchAll(/\{([FO]\d+)\}/g)) used.add(m[1]);
  if (facts && used.size) {
    for (const id of used)
      if (!facts.ids.has(id)) r.add("error", null, `marker {${id}} is not an id in the facts file`);
  }
  const paras = paragraphs(items).filter(
    (p) => !(p.type === "quote" && VERSION_NOTE_LINE.test(`> ${p.text}`)),
  );
  if (used.size) {
    const missing = [];
    for (const p of paras) {
      for (const s of sentences(p.text)) {
        if (s.match(MARKER) || TLDR.test(s)) continue;
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
    const unused = [...facts.ids].filter((id) => id.startsWith("F") && !used.has(id));
    if (used.size && unused.length) r.add("warn", null, `facts not cited: ${unused.join(", ")}`);
  }

  const proseItems = items
    .filter((it) => ["text", "list", "quote", "heading", "caption", "table"].includes(it.type))
    .concat(figureLines(doc));
  languageRules(lang, proseItems, paras, sectionsOf(items), settings, r);
  return { h2, used, footer, page: sizes?.page };
}

/** Landing strings: one `key: text` line each; the language rules read the values. */
function checkLanding(doc, lang, prof, r) {
  const values = [];
  if (doc.metaRaw !== null) r.add("error", 1, "landing strings carry no frontmatter");
  for (const it of doc.items) {
    if (it.type === "blank") continue;
    const m = /^([A-Za-z0-9_.[\]-]+):\s+(.+)$/.exec(it.line);
    if (!m) {
      r.add("error", it.n, "not a `key: text` line");
      continue;
    }
    if (/^["'].*["']$/.test(m[2].trim()))
      r.add("warn", it.n, `${m[1]}: quoted (the quotes would be copied too)`);
    if (m[2].match(MARKER)) r.add("error", it.n, `${m[1]}: fact marker`);
    if (/[*_`#[\]]/.test(m[2].replace(/\[[^\]]*\]/g, "")))
      r.add("warn", it.n, `${m[1]}: Markdown in a plain string`);
    for (const msg of flankingProblems(m[2])) r.add("error", it.n, `${m[1]}: ${msg}`);
    values.push({ type: "text", line: m[2], n: it.n });
  }
  languageRules(lang, values, [], [{ n: null, items: values }], profileSettings(prof), r);
  return values.length;
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
  const inlineIds = (d) =>
    d.items.filter((it) => it.type === "htmlfigure").map((it) => htmlFigureId(it.line));
  if (inlineIds(a).join() !== inlineIds(b).join()) {
    r.add(
      "error",
      null,
      `inline figures differ: [${inlineIds(a).join(", ")}] here, [${inlineIds(b).join(", ")}] in ${b.file}`,
    );
  }
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
  const vnote = (d) => !!versionNoteOf(d);
  if (vnote(a) !== vnote(b))
    r.add("error", null, "version note present in only one of the two files");
  const foot = (d) => d.items.some((it) => it.type === "footer");
  if (foot(a) !== foot(b))
    r.add("error", null, "**Sources** footer present in only one of the two files");

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
  // Each language numbers its sources by its own first use, so the two lists are compared as
  // sets of sources (URL, or title for a source without one), and citations by source.
  const sourcesByLabel = (d) => {
    const map = new Map();
    for (const it of d.items.filter((x) => x.type === "footnote")) {
      const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(it.line.trim());
      const link = /^\[[\s\S]*\]\((\S+)\)$/.exec(m[2].trim());
      map.set(m[1], link ? link[1] : `nolink:${m[2].trim()}`);
    }
    return map;
  };
  const ka = sourcesByLabel(a);
  const kb = sourcesByLabel(b);
  {
    const { onlyA, onlyB } = multisetDiff([...ka.values()], [...kb.values()]);
    if (onlyA.length || onlyB.length) {
      r.add(
        "error",
        null,
        `the two posts cite different sources: only here [${onlyA.join(", ")}]; only in ${path.basename(b.file)} [${onlyB.join(", ")}]`,
      );
    }
  }
  const sa = splitSections(a.raw);
  const sb = splitSections(b.raw);
  if (sa.length !== sb.length) {
    r.add(
      "error",
      null,
      `${sa.length - 1} sections here, ${sb.length - 1} in ${path.basename(b.file)}`,
    );
  }
  const langOfA = langA ?? "en";
  const zhSide = langOfA === "zh" ? "a" : langB === "zh" ? "b" : undefined;
  const zhBudgets = zhSide
    ? budgetsOf(resolveProfile(o, a.meta, { announce: false }), "zh", {})
    : undefined;
  const markersOf = (d) =>
    d.items.flatMap((it) => (it.type === "code" ? [] : (it.line.match(MARKER) ?? [])));
  const facts = o.facts ? loadFacts(o.facts) : null;
  // The sources each section cites, as sets: from its footnotes once published, or, in a draft
  // with --facts, from its marker groups as strip's citer will pick them. The walk covers the whole
  // post, since every source is cited once per post.
  const citedBySection = (d, labels) => {
    const out = [new Set()];
    const pick = facts?.sources.size ? citer(facts) : undefined;
    const summary = tldrLines(d.items);
    const starts = paragraphStarts(d.items);
    for (const it of d.items) {
      if (pick && starts.has(it.n)) pick.paragraph();
      if (summary.has(it.n)) continue;
      if (it.type === "heading" && /^## /.test(it.line)) {
        out.push(new Set());
        continue;
      }
      if (["code", "fence", "footnote", "figure"].includes(it.type)) continue;
      const keys = out[out.length - 1];
      for (const m of it.line.matchAll(/\[\^([^\]\s]+)\]/g))
        keys.add(labels.get(m[1]) ?? `[^${m[1]}]`);
      for (const g of pick ? (it.line.match(/(?:\{[FO]\d+\})+/g) ?? []) : []) {
        const s = pick.pick(g.match(/[FO]\d+/g));
        if (s) keys.add(sourceKey(s));
      }
    }
    return out.map((keys) => [...keys].sort());
  };
  const citedA = citedBySection(a, ka);
  const citedB = citedBySection(b, kb);
  // Both languages stress the same sentence in each section; a number in one and not the other
  // means they stress different ones.
  const stressA = emphasisCheck(a.raw, langA ?? "en", {}).spans;
  const stressB = emphasisCheck(b.raw, langB ?? "en", {}).spans;
  const digits = (spans) =>
    spans
      .flatMap((x) => x.text.match(/\d+(?:[.,]\d+)*/g) ?? [])
      .sort()
      .join();
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const da = parseText(sa[i].text, `${a.file}#s${i}`);
    const db = parseText(sb[i].text, `${b.file}#s${i}`);
    const where = i === 0 ? "the lead" : `section ${i}`;
    compare(`${where}: code spans`, codeSpans(da), codeSpans(db), "error");
    compare(`${where}: URLs`, urlsOf(da), urlsOf(db), "error");
    compare(`${where}: fact markers`, markersOf(da), markersOf(db), "error");
    compare(`${where}: cited sources`, citedA[i] ?? [], citedB[i] ?? [], "error");
    const ea = stressA[i] ?? [];
    const eb = stressB[i] ?? [];
    if (ea.length !== eb.length) {
      r.add(
        "error",
        null,
        `${where}: ${ea.length} emphasized span(s) here, ${eb.length} in ${path.basename(b.file)}`,
      );
    } else if (digits(ea) !== digits(eb)) {
      r.add(
        "warn",
        null,
        `${where}: the emphasized spans hold different numbers ([${digits(ea)}] here, [${digits(eb)}] in ${path.basename(b.file)})`,
      );
    }
    compare(`${where}: numbers`, numbersOf(da), numbersOf(db), "warn");
    const fa2 = da.figures.map((f) => `${f.id}:${f.text.length}`);
    const fb2 = db.figures.map((f) => `${f.id}:${f.text.length}`);
    if (fa2.join() !== fb2.join()) {
      r.add(
        "error",
        null,
        `${where}: figure blocks [${fa2.join(", ")}] here, [${fb2.join(", ")}] in ${path.basename(b.file)}`,
      );
    }
    if (zhSide) {
      const [zhText, enText] = zhSide === "a" ? [sa[i].text, sb[i].text] : [sb[i].text, sa[i].text];
      const zh = countBody(zhText, "zh");
      const en = countBody(enText, "en");
      if (en && zh > en * ZH_PER_EN_MAX) {
        r.add(
          "warn",
          null,
          `${where}: ${zh} Chinese characters for ${en} English words (above ${ZH_PER_EN_MAX} per word)`,
        );
      }
      const cap = rowCap(zhBudgets, i, undefined);
      const zhSized = i === 0 ? leadCounts(zhText, "zh").lead : zh;
      if (cap !== undefined && zhSized > cap)
        r.add("error", null, `${where}: ${zhSized} Chinese characters; the cap is ${cap}`);
    }
  }
}

// ---------------------------------------------------------------------------
// plan / assemble / route
// ---------------------------------------------------------------------------

function runPlan(o) {
  if (!o.in) fail("plan needs --in <outline>");
  const lang = checkLang(o.lang ?? langOf(o.in) ?? "en", "--lang");
  const prof = resolveProfile(o, {}, { announce: false });
  const outline = parseOutline(read(o.in, "--in"));
  const budgets = budgetsOf(prof, lang, o);
  const facts = o.facts ? loadFacts(o.facts) : undefined;
  const manifest = o.figures ? manifestStems(read(o.figures, "--figures")) : undefined;
  const problems = planProblems(outline, budgets, { facts, manifest });
  const sum = outline.rows.reduce((s, r) => s + (r.budget > 0 ? r.budget : 0), 0);
  for (const row of outline.rows) {
    process.stdout.write(
      `  ${String(row.n).padStart(2)}  ${String(row.budget).padStart(4)} ${budgets.unit}  ${row.figures.join(", ") || "—"}  ${row.heading}\n`,
    );
  }
  process.stdout.write(
    `plan ${o.in} (${prof.name}, ${lang}): ${outline.rows.length} rows, ${sum} ${budgets.unit}` +
      `${budgets.total ? ` of at most ${budgets.total.cap}` : ""}\n`,
  );
  if (problems.length) {
    for (const p of problems) process.stdout.write(`ERROR ${p}\n`);
    const file = path.join(path.dirname(o.in), "outline-feedback.auto.md");
    writeFileSync(file, planFeedback(problems));
    process.stdout.write(
      `wrote ${file}; rerun once: outline … --feedback ${file} --previous ${o.in}\n`,
    );
    process.exit(1);
  }
  if (o.freeze) {
    const frozen = path.join(path.dirname(o.in), "outline.final.md");
    const text = read(o.in);
    if (existsSync(frozen) && read(frozen) !== text) {
      fail(`${frozen} exists and differs; the outline is frozen once (delete it to refreeze)`, 1);
    }
    writeFileSync(frozen, text);
    process.stdout.write(`froze ${frozen}\n`);
  }
}

/** Concatenate the sections of one language in order, byte for byte; refuse a gap or a shared figure. */
function runAssemble(o) {
  const dir = o["sections-dir"];
  if (!dir) fail("assemble needs --sections-dir <dir>");
  if (!o.out) fail("assemble needs --out <draft.<lang>.vN.md>");
  const lang = checkLang(o.lang ?? langOf(o.out) ?? "", "assemble: pass --lang en|zh");
  const files = sectionFiles(dir, lang);
  if (!files.size) fail(`no s<n>.${lang}.v<k>.md files in ${dir}`);
  const pins = new Map(
    (o.pin ?? []).map((p) => {
      const m = /^s(\d+)=v(\d+)$/.exec(p);
      if (!m) fail(`--pin ${p}: write it as s<n>=v<k>`);
      return [Number(m[1]), Number(m[2])];
    }),
  );
  const outline = o.outline ? parseOutline(read(o.outline, "--outline")) : undefined;
  const last = Math.max(...files.keys(), outline ? outline.rows.length - 1 : 0);
  const chosen = [];
  for (let n = 0; n <= last; n++) {
    const list = files.get(n);
    if (!list) fail(`section s${n}.${lang} is missing in ${dir} (sections run 0 to ${last})`);
    const pick = pins.has(n) ? list.find((x) => x.v === pins.get(n)) : list[list.length - 1];
    if (!pick) fail(`--pin s${n}=v${pins.get(n)}: no such file`);
    chosen.push({ n, ...pick, text: read(pick.file) });
  }
  for (const n of pins.keys()) if (n > last) fail(`--pin s${n}: there is no section ${n}`);
  if (!chosen[0].text.startsWith("---\n"))
    fail(`s0 (the lead, ${chosen[0].file}) has no frontmatter`);
  const owners = new Map();
  for (const s of chosen) {
    for (const id of figureIdsIn(s.text)) {
      if (owners.has(id)) fail(`figure ${id} is in s${owners.get(id)} and in s${s.n}`);
      owners.set(id, s.n);
    }
  }
  const out = `${chosen.map((s) => s.text.replace(/\s+$/, "")).join("\n\n")}\n`;
  writeFileSync(o.out, out);
  const prof = resolveProfile(o, splitFrontmatter(chosen[0].text).meta, { announce: false });
  const budgets = budgetsOf(prof, lang, o);
  let total = 0;
  for (const s of chosen) {
    const sizes = s.n === 0 ? leadCounts(s.text, lang) : { lead: countBody(s.text, lang) };
    const count = sizes.lead;
    total += count + (sizes.tldr ?? 0);
    const row = outline?.rows.find((r) => r.n === s.n);
    const planned = row && outline.unit === budgets.unit ? row.budget : undefined;
    const cap = rowCap(budgets, s.n, planned);
    const owned = figureIdsIn(s.text);
    const flag = cap !== undefined && count > cap ? "  OVER" : "";
    process.stdout.write(
      `  s${s.n}  v${s.v}  ${String(count).padStart(4)} ${budgets.unit}` +
        `${planned !== undefined ? ` / plan ${planned}` : ""}${cap !== undefined ? ` / cap ${cap}` : ""}` +
        `${sizes.tldr !== undefined ? `  TL;DR ${sizes.tldr}${budgets.tldr ? ` / cap ${budgets.tldr.cap}` : ""}` : ""}` +
        `  figures: ${owned.join(", ") || "—"}${flag}\n`,
    );
    if (row && owned.join() !== row.figures.join()) {
      note(`s${s.n} owns [${owned.join(", ")}]; its plan row gives [${row.figures.join(", ")}]`);
    }
  }
  process.stdout.write(
    `wrote ${o.out}: ${chosen.length} sections, ${total} ${budgets.unit}` +
      `${budgets.total ? ` of at most ${budgets.total.cap}` : ""}\n`,
  );
}

/** Normalised for locating a quoted passage: markers, code ticks and emphasis gone, quotes folded. */
function locatable(text) {
  // A marker may sit before the period ("…08 {F1}.") or after it; neither placement may stop a quote matching.
  return foldQuotes(text.replace(/[ \t]*\{[FO]\d+\}/g, "").replace(/[`*]/g, ""))
    .replace(/\s+/g, " ")
    .replace(/ (?=[.,;:!?。，；：！？、）」』])/g, "")
    .trim();
}

/** Split a merged findings list by the section that holds each quoted passage. */
function runRoute(o) {
  if (!o.findings) fail("route needs --findings <findings.<lang>.vN.md>");
  const dir = o["sections-dir"];
  if (!dir) fail("route needs --sections-dir <dir>");
  const lang = checkLang(o.lang ?? langOf(o.findings) ?? "", "route: pass --lang en|zh");
  const version = /\.v(\d+)\b/.exec(path.basename(o.findings))?.[1] ?? "1";
  const items = findingItems(read(o.findings, "--findings"));
  const sections = [...sectionFiles(dir, lang).entries()].map(([n, list]) => ({
    n,
    text: locatable(read(list[list.length - 1].file)),
  }));
  const routed = new Map();
  const unrouted = [];
  for (const { item, quote } of items) {
    const hits = quote ? sections.filter((s) => s.text.includes(locatable(quote))) : [];
    if (hits.length === 1) {
      if (!routed.has(hits[0].n)) routed.set(hits[0].n, []);
      routed.get(hits[0].n).push(item);
    } else {
      unrouted.push(
        `${item}\n   (route: ${quote ? `found in ${hits.length} sections` : "no [quoted passage]"})`,
      );
    }
  }
  const renumber = (list) => list.map((item, i) => item.replace(/^\d+\./, `${i + 1}.`)).join("\n");
  const base = path.dirname(o.findings);
  for (const [n, list] of [...routed.entries()].sort((a, b) => a[0] - b[0])) {
    const file = path.join(base, `findings.s${n}.${lang}.v${version}.md`);
    writeFileSync(file, `${renumber(list)}\n`);
    process.stdout.write(`s${n}: ${list.length} finding(s) → ${file}\n`);
  }
  if (unrouted.length) {
    const file = path.join(base, `findings.unrouted.${lang}.v${version}.md`);
    writeFileSync(file, `${renumber(unrouted)}\n`);
    process.stdout.write(
      `unrouted: ${unrouted.length} finding(s) → ${file} (for the orchestrator)\n`,
    );
  }
  process.stdout.write(
    `route: ${items.length} findings, ${items.length - unrouted.length} routed\n`,
  );
}

// ---------------------------------------------------------------------------
// Citations: fact markers become numbered footnotes
// ---------------------------------------------------------------------------

const sourceKey = (s) => (s.url ? s.url : `nolink:${s.title}`);

/**
 * The citer for one post. Every source is cited once per post, and a paragraph cites at most once:
 * a marker group (the markers closing one sentence) offers, of its facts in the writer's order, the
 * first whose first public source (tag order is priority) is not cited yet, and only the first
 * group of a paragraph that offers one gets its footnote. The paragraph's other groups cite
 * nothing, so their sources stay free for a later paragraph. Opinions, private sources and facts
 * listed under ## NOCITE cite nothing. strip numbers what it picks, and check and pair walk a draft
 * with the same citer, so all three agree; each calls `paragraph()` where a paragraph starts.
 */
function citer(facts, problems = new Set()) {
  const cited = new Set();
  let paragraphCited = false;
  return {
    paragraph() {
      paragraphCited = false;
    },
    pick(ids) {
      const candidates = [];
      for (const id of ids) {
        if (id.startsWith("O")) continue;
        if (!facts.ids.has(id)) {
          problems.add(`{${id}} is not an id in the facts file`);
          continue;
        }
        const tags = facts.tags.get(id) ?? [];
        if (!tags.length) problems.add(`{${id}} has no [S…] source tag`);
        let first;
        for (const t of tags) {
          const s = facts.sources.get(t);
          if (!s) problems.add(`{${id}} names ${t}, which is not in ## SOURCES`);
          else if (!first && (s.kind === "url" || s.kind === "nolink")) first = s;
        }
        if (first && !facts.nocite.has(id)) candidates.push(first);
      }
      if (paragraphCited) return undefined;
      const s = candidates.find((c) => !cited.has(sourceKey(c)));
      if (!s) return undefined;
      cited.add(sourceKey(s));
      paragraphCited = true;
      return s;
    },
  };
}

/**
 * The line numbers where the citer's paragraphs start, as `paragraphs` splits them: every list
 * item, every table row, and a text or quote line after anything else.
 */
function paragraphStarts(items) {
  const starts = new Set();
  let prev = null;
  for (const it of items) {
    if (it.type === "table") starts.add(it.n);
    if (!["text", "list", "quote"].includes(it.type)) {
      prev = null;
      continue;
    }
    if (it.type === "list" || !prev || prev.type !== it.type) starts.add(it.n);
    prev = it;
  }
  return starts;
}

const TERMINATOR = ".!?,;:。！？，；：、";
/** The punctuation and closing marks before a marker group, the group, and punctuation after it. */
const CITE_RUN = new RegExp(
  `((?:[${TERMINATOR})）"”’」』\\]_]|\\*{1,2})*)[ \\t]*((?:\\{[FO]\\d+\\})+)([${TERMINATOR}]*)`,
  "g",
);

/**
 * Where a citation goes: before the punctuation that ends its clause (`text[^1].`, `文字[^1]。`),
 * and outside a closing quotation mark, bracket or emphasis (`"slope"[^1].`). When the
 * punctuation sits inside the closing mark (`slope."`), the citation follows the whole run, and
 * check warns.
 */
function placeCitation(run, ref, after) {
  if (!ref) return run + after;
  const tail = new RegExp(`[${TERMINATOR}]*$`).exec(run)[0];
  const head = run.slice(0, run.length - tail.length);
  if (new RegExp(`[${TERMINATOR}]`).test(head)) return run + ref + after;
  return head + ref + tail + after;
}

/** The source → number map a published post's `[^n]: …` lines carry. */
function readNumbering(file) {
  const map = new Map();
  for (const line of read(file, "--numbering-from").split("\n")) {
    const m = /^\[\^(\d+)\]:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const link = /^\[([\s\S]*)\]\((\S+)\)$/.exec(m[2].trim());
    map.set(
      link ? link[2] : `nolink:${decode(m[2].trim().replace(/\\([[\]])/g, "$1"))}`,
      Number(m[1]),
    );
  }
  if (!map.size) fail(`${file} has no [^n]: definitions to number from`, 1);
  return map;
}

/**
 * The citation renderer for one post: each marker group becomes at most one `[^n]`, the source
 * the citer picks, before the punctuation that ends its clause, numbered by first use (or by the
 * other language's map). `paragraph()` is called where a paragraph starts.
 */
function citations(facts, numberingFrom) {
  if (!facts.sources.size) fail("the facts file has no ## SOURCES section; citations need it", 1);
  const fixed = numberingFrom ? readNumbering(numberingFrom) : null;
  const numbers = new Map();
  const order = [];
  const used = new Map();
  const problems = new Set();
  const numberOf = (s) => {
    const key = sourceKey(s);
    if (!numbers.has(key)) {
      let n = fixed ? fixed.get(key) : numbers.size + 1;
      if (n === undefined) {
        problems.add(`source "${s.title}" is cited here but not in the --numbering-from post`);
        n = 1000 + numbers.size;
      }
      numbers.set(key, n);
      used.set(n, s);
      order.push(n);
    }
    return numbers.get(key);
  };
  const picker = citer(facts, problems);
  const refs = (group) => {
    const s = picker.pick(group.match(/[FO]\d+/g));
    return s ? `[^${numberOf(s)}]` : "";
  };
  const render = (line) =>
    line.replace(CITE_RUN, (m, run, group, after) => placeCitation(run, refs(group), after));
  const definitions = () => {
    if (fixed) {
      for (const [key, n] of fixed) {
        if (!numbers.has(key))
          problems.add(`source [^${n}] of the --numbering-from post is never cited here`);
      }
      const at = order.findIndex((n, i) => i > 0 && n < order[i - 1]);
      if (at !== -1) {
        problems.add(
          `this language first cites the sources in another order than the --numbering-from post ` +
            `(it reaches [^${order[at - 1]}] before [^${order[at]}]); footnotes are numbered by ` +
            `first use, so strip this language without --numbering-from — pair compares the two ` +
            `reference sets, not their numbers`,
        );
      }
    }
    return [...used.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, s]) =>
        s.url
          ? `[^${n}]: [${escapeInline(s.title).replace(/([[\]])/g, "\\$1")}](${s.url})`
          : `[^${n}]: ${escapeInline(s.title)}`,
      );
  };
  return {
    render,
    definitions,
    problems,
    paragraph: () => picker.paragraph(),
    cited: () => used.size,
  };
}

/** The footnotes of a stripped post: defined, used, numbered 1 … N, linked to SOURCES. */
function checkFootnotes(doc, o, r, facts) {
  const refs = [];
  for (const it of doc.items) {
    if (["code", "fence", "footnote"].includes(it.type)) continue;
    for (const m of it.line.matchAll(/\[\^([^\]\s]+)\]/g)) {
      if (["htmlfigure", "caption", "figure", "image"].includes(it.type)) {
        r.add("error", it.n, "a citation inside a figure or a caption");
      }
      refs.push({ n: Number(m[1]), line: it.n });
    }
  }
  const defs = doc.items
    .filter((it) => it.type === "footnote")
    .map((it) => {
      const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(it.line.trim());
      return { n: Number(m[1]), body: m[2], line: it.n };
    });
  if (!refs.length && !defs.length) return;
  if (doc.raw.match(MARKER)) {
    r.add(
      "error",
      null,
      "footnotes in a draft that still has fact markers: citations are generated by strip, not written",
    );
    return;
  }
  const defined = new Map();
  for (const d of defs) {
    if (Number.isNaN(d.n)) r.add("error", d.line, "a footnote label that is not a number");
    else if (defined.has(d.n)) r.add("error", d.line, `[^${d.n}] is defined twice`);
    defined.set(d.n, d);
  }
  const usedNs = new Set(refs.map((x) => x.n));
  for (const x of refs)
    if (!defined.has(x.n)) r.add("error", x.line, `[^${x.n}] has no definition`);
  for (const d of defs)
    if (!usedNs.has(d.n)) r.add("error", d.line, `[^${d.n}] is defined and never cited`);
  const ns = [...defined.keys()].sort((a, b) => a - b);
  if (ns.some((n, i) => n !== i + 1))
    r.add("error", null, `footnotes are numbered ${ns.join(", ")}; they run 1 … N`);
  // The site renders a footnote's number by first use and its anchor by its label, so a label
  // out of first-use order would show one number and jump to another.
  const firstUse = [...new Set(refs.map((x) => x.n))];
  if (firstUse.some((n, i) => n !== i + 1)) {
    r.add(
      "error",
      null,
      `footnote labels first appear in the order ${firstUse.join(", ")}; they must run 1, 2, 3 … as they first appear (strip without --numbering-from renumbers them)`,
    );
  }
  const lastBody = doc.items
    .filter((it) => !["blank", "footnote", "comment"].includes(it.type))
    .pop();
  const firstDef = defs[0];
  if (lastBody && firstDef && lastBody.n > firstDef.line)
    r.add("error", lastBody.n, "text after the footnote definitions");
  const sources = facts ? [...facts.sources.values()] : [];
  for (const d of defs) {
    const link = /^\[([\s\S]*)\]\((\S+)\)$/.exec(d.body.trim());
    if (link) {
      if (/\/blob\/main\//.test(link[2]))
        r.add("error", d.line, `[^${d.n}] links blob/main; pin it to the release`);
      if (facts && !sources.some((s) => s.url === link[2]))
        r.add("error", d.line, `[^${d.n}] links ${link[2]}, which is not in ## SOURCES`);
    } else if (
      facts &&
      !sources.some((s) => s.kind === "nolink" && escapeInline(s.title) === d.body.trim())
    ) {
      r.add("error", d.line, `[^${d.n}] is neither [title](url) nor the title of a nolink source`);
    }
  }
  for (const it of doc.items.filter((x) => x.type === "heading")) {
    const id = HEADING.exec(it.line)[2].trim().toLowerCase().replace(/\s+/g, "-");
    if (id === "footnote-label" || /^fn(ref)?-\d/.test(id)) {
      r.add("error", it.n, `the heading's anchor "${id}" collides with the footnote ids`);
    }
  }
}

/** What a draft's markers promise for its citations: tagged facts, public sources, pinned links. */
function checkSources(doc, r, facts) {
  if (!facts.sources.size) {
    r.add(
      "error",
      null,
      "the facts file has no ## SOURCES section, so no citation can be generated",
    );
    return;
  }
  for (const s of facts.sources.values()) {
    if (s.kind === "unknown")
      r.add("error", null, `${s.id}: "${s.raw}" is not a URL, private or nolink`);
    if (s.url && /\/blob\/main\//.test(s.url))
      r.add("error", null, `${s.id} links blob/main; pin it to the release`);
  }
  const cited = new Set();
  for (const it of doc.items) for (const m of it.line.matchAll(/\{(F\d+)\}/g)) cited.add(m[1]);
  for (const id of cited) {
    if (!facts.ids.has(id)) continue;
    const tags = facts.tags.get(id) ?? [];
    if (!tags.length) {
      r.add("error", null, `{${id}} is cited and its fact has no [S…] source tag`);
      continue;
    }
    for (const t of tags)
      if (!facts.sources.has(t))
        r.add("error", null, `{${id}} names ${t}, which is not in ## SOURCES`);
    const kinds = tags.map((t) => facts.sources.get(t)?.kind);
    if (kinds.every((k) => k === "private")) {
      r.add("warn", null, `no reference will be rendered for {${id}}: its sources are all private`);
    }
  }
}

/** Budgets: a section above its cap (or 1.1 × its plan) is an error, one below its floor a warning. */
function checkBudgets(doc, lang, prof, o, r, { section } = {}) {
  const budgets = budgetsOf(prof, lang, o);
  const outline = o.outline ? parseOutline(read(o.outline, "--outline")) : undefined;
  const plan = outline && outline.unit === budgets.unit ? outline : undefined;
  const u = budgets.unit;
  // A whole post written in one call holds its plan rows as targets: above the row is a warning,
  // above the profile's cap still an error.
  const advisory = o["plan-rows"] === "advisory";
  if (o["plan-rows"] !== undefined && !["hard", "advisory"].includes(o["plan-rows"])) {
    fail("--plan-rows is hard or advisory");
  }
  const judge = (n, count, line) => {
    const row = plan?.rows.find((x) => x.n === n);
    const limit = n === 0 ? budgets.lead : budgets.section;
    const cap = advisory ? limit?.cap : rowCap(budgets, n, row?.budget);
    const what = n === 0 ? "the lead" : `section ${n}`;
    if (cap !== undefined && count > cap) {
      r.add(
        "error",
        line,
        `${what} is ${count} ${u}; its cap is ${cap}${advisory ? " (the profile's)" : row ? ` (plan ${row.budget}, profile cap ${limit?.cap ?? "none"})` : ""}`,
      );
    } else if (advisory && row && count > Math.round(row.budget * 1.1)) {
      r.add("warn", line, `${what} is ${count} ${u}; its plan row is ${row.budget}`);
    } else if (limit && count < limit.floor) {
      r.add("warn", line, `${what} is ${count} ${u}, below the profile's floor of ${limit.floor}`);
    }
    if (n > 0 && count === 0) r.add("error", line, `${what} has no body text`);
    return count;
  };
  const tldrJudge = (count) => {
    if (count === undefined || !budgets.tldr) return count ?? 0;
    if (count > budgets.tldr.cap) {
      r.add("error", null, `the TL;DR is ${count} ${u}; its cap is ${budgets.tldr.cap}`);
    } else if (count < budgets.tldr.floor) {
      r.add(
        "warn",
        null,
        `the TL;DR is ${count} ${u}, below the profile's floor of ${budgets.tldr.floor}`,
      );
    }
    return count;
  };
  const sized = (n, text, line) => {
    if (n !== 0) return judge(n, countBody(text, lang), line);
    const { lead, tldr } = leadCounts(text, lang);
    return judge(0, lead, line) + tldrJudge(tldr);
  };
  if (section !== undefined) {
    const counts = [sized(section, doc.raw, null)];
    // A section file beside its siblings: the page total it makes, so creep shows before assembly.
    const page = sectionOfFile(doc.file)
      ? pageReport(path.dirname(doc.file), lang, section, doc.raw, outline, budgets, o.page)
      : undefined;
    if (page?.over) r.add("warn", null, page.line);
    return { counts, page };
  }
  const sections = splitSections(doc.raw);
  const counts = sections.map((s) => sized(s.n, s.text, s.n ? s.line : null));
  const total = counts.reduce((a, b) => a + b, 0);
  if (budgets.total && total > budgets.total.cap) {
    r.add("error", null, `the body is ${total} ${u}; the cap is ${budgets.total.cap}`);
  } else if (budgets.total && total < budgets.total.floor) {
    r.add(
      "warn",
      null,
      `the body is ${total} ${u}, below the profile's floor of ${budgets.total.floor}`,
    );
  }
  if (plan && plan.rows.length !== sections.length) {
    r.add(
      "error",
      null,
      `${sections.length - 1} sections after the lead; the plan has ${plan.rows.length - 1}`,
    );
  }
  return { counts };
}

function runCheck(o) {
  if (!o.in) fail("check needs --in <file>");
  const doc = parseDoc(o.in);
  const lang = checkLang(
    o.lang ?? langOf(o.in) ?? "",
    `${o.in}: no .en./.zh. in the name; pass --lang`,
  );
  const prof = resolveProfile(o, doc.meta, { announce: false });
  const r = reporter(o.in);
  let summary;
  if (prof.kind === "landing") {
    summary = `${checkLanding(doc, lang, prof, r)} strings`;
  } else {
    const facts = o.facts ? loadFacts(o.facts) : null;
    const info = checkDoc(doc, lang, prof, o, r, facts);
    const counterpart = o.pair ?? o.with;
    if (counterpart) pairDocs(doc, parseDoc(counterpart), o, r);
    const f = [...info.used].filter((id) => id.startsWith("F")).length;
    const inline = doc.items.filter((it) => it.type === "htmlfigure").length;
    summary =
      `${info.h2.length} sections · ${doc.figures.length} figure blocks · ${inline} inline figures · ` +
      `${images(doc).length} images · ${doc.items.filter((it) => it.type === "fence").length} code fences · ` +
      `${doc.items.filter((it) => it.type === "footnote").length} references · ` +
      `${info.used.size ? `${info.used.size} distinct markers (F ${f}, O ${info.used.size - f})` : "no markers"}` +
      `${info.page ? ` · page ${info.page.total} of at most ${info.page.cap} ${info.page.unit}` : ""}`;
  }
  process.stdout.write(`${doc.file} (${lang}, ${prof.name}): ${summary}\n`);
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
  const warns = r.hits.length - errors;
  process.stdout.write(
    `pair ${o.in} ↔ ${counterpart}: ${errors} error${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}\n`,
  );
  process.exit(errors ? 1 : 0);
}

/** `<`, `>` and `&` as entities outside code spans, so a placeholder like `<path>` stays text. */
function escapeInline(text) {
  return text
    .split(/((`+)[\s\S]*?[^`]\2(?!`))/)
    .map((part, i) =>
      i % 3 === 0 ? part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : part,
    )
    .filter((part, i) => i % 3 !== 2)
    .join("");
}

/** The published form of a figure block: its drawn file on one line, or a screenshot image line. */
function publishFigure(fig, lang, o) {
  if (isDrawn(fig)) {
    if (!o["figures-dir"])
      fail(`figure ${fig.id} is drawn (it has strings); pass --figures-dir <dir>`, 1);
    const file = figureFile(o["figures-dir"], fig, lang);
    if (!existsSync(file)) fail(`figure ${fig.id} is drawn and ${file} does not exist`, 1);
    // One line: a blank line inside a <figure> would end the Markdown HTML block early.
    const html = read(file)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    if (!HTML_FIGURE.test(html) || !html.endsWith("</figure>")) {
      fail(`${file} is not one <figure class="post-figure" …>…</figure> element`, 1);
    }
    // An unescaped `<path>` in a label parses as a tag, so it shows up here as a mismatch.
    const problems = figureProblems(html, fig, { slug: slugOf(o, o.out), lang });
    if (problems.length)
      fail(`${file} does not match figure ${fig.id}'s block:\n  ${problems.join("\n  ")}`, 1);
    return [html];
  }
  let ext = "png";
  if (o.assets && !existsSync(path.join(o.assets, `${fig.id}-${lang}.png`))) {
    if (existsSync(path.join(o.assets, `${fig.id}-${lang}.jpg`))) ext = "jpg";
    else note(`${fig.id}-${lang}.png is not under --assets yet`);
  }
  return [
    `![${escapeInline(fig.alt ?? "")}](/blog-assets/${fig.id}-${lang}.${ext})`,
    `_${escapeInline(fig.caption ?? "")}_`,
  ];
}

const CJK_PUNCT = "。，；：！？、）」』";

/**
 * A space that removing a marker left next to CJK punctuation (`CLAUDE.md。 Anthropic`): drop
 * it after the punctuation and before it. Code spans keep their spaces.
 */
function tidyCjkSpaces(line) {
  return line.replace(
    new RegExp(
      `(\`+)[\\s\\S]*?[^\`]\\1(?!\`)|[ \\t]+(?=[${CJK_PUNCT}])|(?<=[${CJK_PUNCT}](?:\\[\\^\\d+\\])*)[ \\t]+`,
      "g",
    ),
    (m) => (m.trim() ? m : ""),
  );
}

/**
 * Straight quotes and apostrophes in English text, outside code spans and URLs: the published
 * English posts use them, and a CJK fallback font draws a curly ’ full-width.
 */
function straightQuotes(line) {
  return line.replace(/(`+)[\s\S]*?[^`]\1(?!`)|\]\([^)]*\)|https?:\/\/[^\s)<>]+|[‘’“”]/g, (m) =>
    m.length === 1 ? foldQuotes(m) : m,
  );
}

function runStrip(o) {
  if (!o.in || !o.out) fail("strip needs --in <file> --out <file>");
  const { body, notes } = stripDoc(parseDoc(o.in), o);
  writeFileSync(o.out, body);
  for (const n of notes) process.stderr.write(`removed note: ${n.trim()}\n`);
  process.stderr.write(`wrote ${o.out}\n`);
}

/**
 * A draft as published: citations from its markers (with `facts`), drawn figures inlined from
 * `figures-dir`, screenshot blocks as image lines. Returns the text and the model's notes it
 * removed; unstrip's guard calls it on the draft it recovered.
 */
function stripDoc(doc, o) {
  const lang = o.lang ?? langOf(doc.file);
  const cite = o.facts ? citations(loadFacts(o.facts), o["numbering-from"]) : null;
  if (!cite && o["numbering-from"]) fail("--numbering-from needs --facts");
  if (!cite && doc.raw.match(/\{F\d+\}/)) note("no --facts: markers removed without citations");
  if (doc.figures.length) {
    checkLang(
      lang ?? "",
      `${doc.file}: no .en./.zh. in the name, and figure blocks need one; pass --lang`,
    );
    const bad = doc.figures.filter((f) => !f.id || !f.closed || !f.alt || !f.caption);
    if (bad.length)
      fail(
        `figure blocks without id, alt, caption or a closing fence at line ${bad.map((f) => f.n).join(", ")}; run check`,
        1,
      );
  }
  const kept = [];
  const summary = tldrLines(doc.items);
  const starts = paragraphStarts(doc.items);
  const notes = [];
  let inComment = false;
  let fence = null;
  let skipUntil = 0;
  const prose = (line) => (lang === "en" ? straightQuotes(line) : tidyCjkSpaces(line));
  const head = doc.metaRaw === null ? "" : `---\n${prose(doc.metaRaw)}\n---\n`;
  const lines = doc.body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = doc.bodyLine + i;
    if (n <= skipUntil) continue;
    const fig = doc.figures.find((f) => f.n === n);
    if (fig) {
      // A drawn figure's HTML keeps its strings as drawn (only English quotes are straightened,
      // which the figure check folds); a screenshot's alt and caption are prose.
      const out = publishFigure(fig, lang, o);
      kept.push(
        "",
        ...out.map((l) => (l.startsWith("<figure") && lang !== "en" ? l : prose(l))),
        "",
      );
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
    // A paragraph cites at most once. The TL;DR sums up the body, so its markers stay in the
    // draft as anchors and cite nothing.
    if (cite && starts.has(n)) cite.paragraph();
    const cited =
      cite && !summary.has(n)
        ? cite.render(line)
        : line.replace(/^(?:\{[FO]\d+\})+[ \t]*/, "").replace(/[ \t]*\{[FO]\d+\}/g, "");
    kept.push(prose(cited));
  }
  if (cite) {
    const defs = cite.definitions();
    if (cite.problems.size) fail(`citations:\n  ${[...cite.problems].join("\n  ")}`, 1);
    if (defs.length) kept.push("", ...defs);
  }
  let body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  body = head ? `${head}\n${body}\n` : `${body}\n`;
  const left = body.match(/\{[FO]\d+\}|\{\{[A-Z_]+\}\}/g);
  if (left) fail(`markers or slots survived the strip: ${[...new Set(left)].join(", ")}`, 1);
  return { body, notes };
}

// ---------------------------------------------------------------------------
// unstrip: a published post back into the draft strip made it from
// ---------------------------------------------------------------------------

/** escapeInline undone: `&lt;`, `&gt;` and `&amp;` outside code spans. */
function unescapeInline(text) {
  return text
    .split(/((`+)[\s\S]*?[^`]\2(?!`))/)
    .map((part, i) =>
      i % 3 === 0 ? part.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : part,
    )
    .filter((part, i) => i % 3 !== 2)
    .join("");
}

/** A figure-block value that parseSpecLine reads back as it is: one wrapped in quotes keeps them. */
function specValue(text) {
  const v = text.replace(/\s+/g, " ").trim();
  if (unquote(v) === v) return v;
  return v.startsWith('"') ? `'${v}'` : `"${v}"`;
}

/** An HTML run as a figure block holds it: tags dropped, entities decoded, spaces collapsed. */
function htmlText(html) {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The figure block an inline figure was drawn from: `alt` from the SVG's `<title>`, `caption` from
 * the `<figcaption>`, `text:` from the fig-steps in order (keys s1 … sn), and `title` from the one
 * drawn leaf with a letter that is not a step. Returns the block's lines and what it cannot hold.
 */
function blockOfFigure(line) {
  const problems = [];
  const id = htmlFigureId(line);
  const svg = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(line)?.[1] ?? "";
  const alt = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(svg)?.[1];
  const caption = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(line)?.[1];
  const ol =
    /<ol\b[^>]*\bclass="[^"]*\bfig-steps\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/.exec(line)?.[1] ?? "";
  const steps = [...ol.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => htmlText(m[1]));
  const known = new Set(steps.map(normalize));
  const extra = [...new Set(svgLeaves(svg, htmlText))].filter(
    (leaf) => /\p{L}/u.test(leaf) && !known.has(normalize(leaf)),
  );
  const what = `figure ${id ?? "(no data-figure)"}`;
  if (!id) problems.push("an inline figure without data-figure");
  if (alt === undefined) problems.push(`${what}: no <title> in its <svg>`);
  if (caption === undefined) problems.push(`${what}: no <figcaption>`);
  if (!steps.length && !extra.length) {
    problems.push(`${what}: no fig-steps and no title, so strip would publish it as a screenshot`);
  }
  if (extra.length > 1) {
    problems.push(
      `${what}: drawn text that is no step and not the one title: ${extra
        .slice(1)
        .map((x) => `"${x.slice(0, 40)}"`)
        .join(", ")}`,
    );
  }
  const lines = [
    `\`\`\`figure id=${id}`,
    `alt: ${specValue(htmlText(alt ?? ""))}`,
    `caption: ${specValue(htmlText(caption ?? ""))}`,
    ...(extra.length ? [`title: ${specValue(extra[0])}`] : []),
    ...(steps.length ? ["text:", ...steps.map((s, i) => `- s${i + 1}: ${specValue(s)}`)] : []),
    "```",
  ];
  return { id, lines, problems };
}

/** The screenshot block an image line and its italic caption were published from. */
function blockOfScreenshot(imageLine, captionLine, lang) {
  const [, alt, src] = IMAGE_LINE.exec(imageLine.trim());
  const m = /^\/blog-assets\/(.+)-(en|zh)\.(png|jpe?g|gif|webp|svg)$/.exec(src);
  const problems = [];
  if (!m) problems.push(`the image "${src}" is not /blog-assets/<name>-<lang>.<ext>`);
  else if (m[2] !== lang) problems.push(`the image "${src}" carries -${m[2]} in a ${lang} post`);
  const id = m?.[1] ?? path.basename(src).replace(/\.[a-z]+$/i, "");
  const lines = [
    `\`\`\`figure id=${id}`,
    `alt: ${specValue(unescapeInline(alt))}`,
    `caption: ${specValue(unescapeInline(captionLine.trim().slice(1, -1)))}`,
    "```",
  ];
  return { id, ext: m?.[3], lines, problems };
}

/** The `[^n]:` list of a published post, by label: title and URL as strip wrote them, unescaped. */
function referenceList(doc) {
  const defs = new Map();
  for (const it of doc.items.filter((x) => x.type === "footnote")) {
    const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(it.line.trim());
    const link = /^\[([\s\S]*)\]\((\S+)\)$/.exec(m[2].trim());
    defs.set(
      m[1],
      link
        ? { title: unescapeInline(link[1].replace(/\\([[\]])/g, "$1")), url: link[2] }
        : { title: unescapeInline(m[2].trim()), url: null },
    );
  }
  return defs;
}

/**
 * How a second language's citations take the first language's ids: the S id of the same source,
 * and the fact id the paired draft cites that source with in the same section (in order, when it
 * cites it more than once there). Anything without a counterpart gets a fresh id.
 */
function unstripAlignment(o) {
  if (!o.facts) fail("unstrip --pair needs --facts <the seed or facts file its markers name>");
  const facts = loadFacts(o.facts);
  const firstSource = (id) =>
    (facts.tags.get(id) ?? [])
      .map((t) => facts.sources.get(t))
      .find((s) => s && (s.kind === "url" || s.kind === "nolink"));
  const bySection = splitSections(read(o.pair, "--pair")).map((part) => {
    const ids = new Map();
    for (const m of part.text.matchAll(/\{(F\d+)\}/g)) {
      const s = firstSource(m[1]);
      if (s) ids.set(sourceKey(s), [...(ids.get(sourceKey(s)) ?? []), m[1]]);
    }
    return ids;
  });
  const sIds = new Map([...facts.sources.values()].map((s) => [sourceKey(s), s.id]));
  const top = (prefix, ids) =>
    Math.max(0, ...[...ids].filter((x) => x.startsWith(prefix)).map((x) => Number(x.slice(1))));
  return {
    nextF: top("F", facts.ids) + 1,
    nextS: top("S", facts.sources.keys()) + 1,
    sourceId: (src) => sIds.get(sourceKey(src)),
    take: (section, src) => bySection[section]?.get(sourceKey(src))?.shift(),
  };
}

const CITED = new RegExp(`((?:\\[\\^[^\\]\\s]+\\])+)([${TERMINATOR}]*)`, "g");

/**
 * unstrip: a published post (drawn figures inline, screenshots as image lines, citations as
 * `[^n]`) back into a draft whose figure blocks and markers strip turns into the same post.
 */
function runUnstrip(o) {
  if (!o.in || !o["out-dir"]) fail("unstrip needs --in <published post> --out-dir <dir>");
  const doc = parseDoc(o.in);
  const lang = checkLang(
    o.lang ?? langOf(o.in) ?? "",
    `${o.in}: no .en./.zh. in the name; pass --lang`,
  );
  if (doc.raw.match(MARKER) || doc.figures.length) {
    fail(`${o.in} is a draft (fact markers or figure blocks); unstrip reads a published post`);
  }
  const dir = o["out-dir"];
  const figDir = path.join(dir, "figures");
  const slug = o.slug ?? /^(.+)\.(en|zh)\.md$/.exec(path.basename(o.in))?.[1] ?? path.basename(dir);
  const defs = referenceList(doc);
  const align = o.pair ? unstripAlignment(o) : undefined;
  const problems = [];
  const files = [];
  const cited = [];
  const sourceIds = new Map();
  let nextF = align?.nextF ?? 1;
  let nextS = align?.nextS ?? 1;
  const sourceId = (label, src) => {
    if (!sourceIds.has(label)) {
      let id = src && align?.sourceId(src);
      if (!id) id = !align && /^\d+$/.test(label) ? `S${label}` : `S${nextS++}`;
      if (align && src && !align.sourceId(src))
        note(`[^${label}] "${src.title}" is not in --facts; it gets ${id}`);
      sourceIds.set(label, id);
    }
    return sourceIds.get(label);
  };
  let section = 0;
  const factFor = (label, n) => {
    const src = defs.get(label);
    if (!src) problems.push(`line ${n}: [^${label}] has no definition`);
    const sid = sourceId(label, src);
    let id = src && align?.take(section, src);
    if (align && !id)
      note(`line ${n}: [^${label}] has no counterpart in --pair's section ${section}`);
    id ??= `F${nextF++}`;
    cited.push({ id, sid, n });
    return `{${id}}`;
  };
  // A citation stood before the punctuation that ends its clause; the marker goes after it, where
  // the writer puts it and strip's citer reads it back (`claim[^1].` ↔ `claim.{F1}`).
  const markers = (line, n) =>
    line
      .split(/((`+)[\s\S]*?[^`]\2(?!`))/)
      .map((part, k) =>
        k % 3 !== 0
          ? part
          : part.replace(
              CITED,
              (m, refs, after) =>
                after +
                [...refs.matchAll(/\[\^([^\]\s]+)\]/g)].map((r) => factFor(r[1], n)).join(""),
            ),
      )
      .filter((part, k) => k % 3 !== 2)
      .join("");
  const out = [];
  const shots = [];
  for (let i = 0; i < doc.items.length; i++) {
    const it = doc.items[i];
    if (it.type === "heading" && /^## /.test(it.line)) section++;
    if (it.type === "footnote") continue;
    if (it.type === "htmlfigure") {
      const b = blockOfFigure(it.line.trim());
      problems.push(...b.problems);
      out.push("", ...b.lines, "");
      files.push([figureFile(figDir, { id: b.id }, lang), `${it.line.trim()}\n`]);
      continue;
    }
    if (it.type === "image" && doc.items[i + 1]?.type === "caption") {
      const b = blockOfScreenshot(it.line, doc.items[i + 1].line, lang);
      problems.push(...b.problems);
      if (b.ext && b.ext !== "png") shots.push(`${b.id}-${lang}.${b.ext}`);
      out.push("", ...b.lines, "");
      i++;
      continue;
    }
    if (it.type === "image") problems.push(`line ${it.n}: an image without its italic caption`);
    out.push(["code", "fence", "comment"].includes(it.type) ? it.line : markers(it.line, it.n));
  }
  const head = doc.metaRaw === null ? "" : `---\n${doc.metaRaw}\n---\n\n`;
  const recovered = `${head}${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;

  // The facts seed: each citation's sentence, read from the draft the way the citer reads it.
  const sentenceOf = new Map();
  const draftDoc = parseText(recovered);
  for (const p of paragraphs(draftDoc.items)) {
    for (const s of sentences(p.text)) {
      const text = s.replace(MARKER, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      for (const m of s.match(MARKER) ?? []) if (!sentenceOf.has(m)) sentenceOf.set(m, text);
    }
  }
  for (const it of draftDoc.items) {
    for (const m of it.line.match(MARKER) ?? []) {
      if (!sentenceOf.has(m)) sentenceOf.set(m, it.line.replace(MARKER, "").trim());
    }
  }
  const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
  const sourceLines = [...defs]
    .map(([label, src]) => [sourceId(label, src), src])
    .sort((a, b) => byNumber(a[0], b[0]))
    .map(([id, src]) => `- ${id}: ${src.title} · ${src.url ?? "nolink"}`);
  const seed = [
    `<!-- Seed recovered by unstrip from ${path.basename(o.in)}: one fact per citation, the sentence that carried it. Merge it into facts.md and verify every fact against its source again. -->`,
    "",
    "## SOURCES",
    ...sourceLines,
    "",
    "## FACTS",
    ...cited.map(({ id, sid }) => `- ${id}: ${sentenceOf.get(`{${id}}`) ?? ""} [${sid}]`),
    "",
  ].join("\n");

  mkdirSync(figDir, { recursive: true });
  const draftFile = path.join(dir, `recovered.${lang}.md`);
  const seedFile = path.join(dir, `facts.${lang}.seed.md`);
  writeFileSync(draftFile, recovered);
  writeFileSync(seedFile, seed);
  for (const [file, text] of files) writeFileSync(file, text);

  const guard = problems.length
    ? { problems: [], lines: 0 }
    : unstripGuard(doc, draftFile, seedFile, { slug, lang, figDir, cite: defs.size > 0 });
  problems.push(...guard.problems);
  const drawn = files.length;
  const shotCount = draftDoc.figures.length - drawn;
  process.stdout.write(
    `${o.in} → ${dir}\n` +
      `  recovered.${lang}.md: ${splitSections(recovered).length - 1} sections · ${drawn} drawn figure block(s) · ${shotCount} screenshot block(s) · ${cited.length} marker(s)\n` +
      `  figures/: ${drawn} file(s), each the inline figure as published\n` +
      `  facts.${lang}.seed.md: ${defs.size} source(s) · ${cited.length} fact(s), one per citation\n`,
  );
  for (const p of problems) process.stdout.write(`ERROR ${p}\n`);
  if (problems.length) {
    process.stdout.write(
      `unstrip: ${problems.length} problem(s); the files are written for reading, not for use\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `  guard: every drawn figure matches its block (check --svg); strip of the draft with the seed gives back ` +
      `every figure and image line byte for byte and the other ${guard.lines} line(s) once citations are removed\n` +
      `  strip under the current citer: ${guard.again.refs} citation(s) and ${guard.again.sources} source(s); the post has ${guard.post.refs} and ${guard.post.sources}\n`,
  );
  if (shots.length) {
    note(
      `${shots.join(", ")}: not .png, so strip needs --assets <community>/blog-assets to keep it`,
    );
  }
  if (path.basename(path.resolve(dir)) !== slug) {
    note(`the folder is not named ${slug}: pass --slug ${slug} to check and strip`);
  }
  const other = lang === "en" ? "zh" : "en";
  if (!o.pair) {
    note(
      `next, the other language: unstrip --in ${o.in.replace(new RegExp(`\\.${lang}\\.md$`), `.${other}.md`)} --out-dir ${dir} --pair ${draftFile} --facts ${seedFile}`,
    );
  }
  note(
    `then merge ${seedFile} into facts.md and verify each fact; write --reuse-figures ${draftFile}; check --in <draft> --svg ${figDir}`,
  );
}

/**
 * unstrip's guard: every drawn figure against its block, as check --svg does, then strip of the
 * recovered draft with the seed against the post: figure and image lines byte for byte (an image's
 * extension aside), every other line once citations are removed. Citations themselves may differ:
 * strip applies the current citer, which can cite fewer.
 */
function unstripGuard(post, draftFile, seedFile, { slug, lang, figDir, cite }) {
  const problems = [];
  const draft = parseDoc(draftFile);
  for (const fig of draft.figures.filter(isDrawn)) {
    for (const p of figureProblems(read(figureFile(figDir, fig, lang)), fig, { slug, lang }))
      problems.push(`figures/${fig.id}.${lang}.html: ${p}`);
  }
  if (problems.length) return { problems, lines: 0 };
  const o = { "figures-dir": figDir, slug, lang, ...(cite ? { facts: seedFile } : {}) };
  const again = parseText(stripDoc(draft, o).body, "strip");
  if (post.metaRaw !== again.metaRaw) problems.push("strip gives back another frontmatter");
  const kept = (d) => d.items.filter((it) => !["blank", "footnote"].includes(it.type));
  const a = kept(post);
  const b = kept(again);
  const bare = (line) => line.replace(/\[\^[^\]\s]+\]/g, "");
  const imageKey = (line) => line.replace(/\.(png|jpe?g|gif|webp|svg)\)\s*$/, ")");
  if (a.length !== b.length)
    problems.push(`strip gives back ${b.length} lines; the post has ${a.length}`);
  for (let i = 0; i < Math.min(a.length, b.length) && problems.length < 8; i++) {
    const [x, y] = [a[i], b[i]];
    const same =
      x.type === "image"
        ? imageKey(x.line) === imageKey(y.line)
        : ["htmlfigure", "caption"].includes(x.type)
          ? x.line === y.line
          : bare(x.line) === bare(y.line);
    if (!same) problems.push(`line ${x.n}: strip gives back "${y.line.slice(0, 80)}"`);
  }
  const refs = (d) =>
    d.items.reduce(
      (k, it) => k + (it.type === "footnote" ? 0 : (it.line.match(/\[\^[^\]\s]+\]/g)?.length ?? 0)),
      0,
    );
  const sources = (d) => d.items.filter((it) => it.type === "footnote").length;
  return {
    problems,
    lines: a.filter((it) => !["htmlfigure", "image", "caption"].includes(it.type)).length,
    post: { refs: refs(post), sources: sources(post) },
    again: { refs: refs(again), sources: sources(again) },
  };
}

// ---------------------------------------------------------------------------
// selftest: the local steps against built-in fixtures, each run as its own process
// ---------------------------------------------------------------------------

const FIXTURE_FACTS = `## FACTS
- F1: Archived tool output is written to a file under the Project root. [S1]
- F2: The Trace keeps a marker where the output was. [S2]
- F3: The archive format was settled in a design review. [S3]
- F4: Seven write-ups describe the same archive. [S4 S5 S6 S7 S8 S9 S10]
- F5: Two write-ups describe the marker. [S11 S12]
- F6: Two write-ups describe the root. [S13 S14]

## SOURCES
- S1: PenguinHarness docs: Agent loop · https://penguin.ooo/docs/agent-loop
- S2: packages/core/src/trace/writer.ts · https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/trace/writer.ts
- S3: design notes (paraphrased) · private
${Array.from({ length: 11 }, (_, i) => `- S${i + 4}: Write-up ${i + 4} · https://example.com/w${i + 4}`).join("\n")}

## OPINIONS
- O1: A marker beats a gap.

## TERMS
| Term | zh |
| --- | --- |
| Trace | Trace |

## NOT-FACTS
- Do not claim the archive is compressed.

## NOCITE
- F6: background that a docs link in the same post already covers
`;

const FIXTURE_DRAFT = `---
title: "Self-test post"
date: 2026-10-19
category: perspectives
excerpt: "A fixture for the script's own checks."
---

Archived output **keeps its place in the Trace**. {F1}

## Where files go

Files live under **one root per Project**. {F1}

\`\`\`figure id=demo-flow
alt: Archived tool output moving to a path under the Project root.
caption: The Trace keeps a marker where the output was.
text:
- step1: <root>/<project>/
- config2: [output archived: <path>]
\`\`\`

## What the Trace keeps

The Trace keeps a short marker. {F2} The writer’s “marker” is kept, and \`it’s\` **stays in code**. {F2}

\`\`\`figure id=demo-shot
alt: The Trace view showing an archived output.
caption: The marker names the file as <path> and the id as \`<id>\`.
\`\`\`

## A marker beats a gap

We would rather **keep a marker than leave a gap**. {O1} The format was settled early {F3}.

## What to read next

The docs describe **the archive in full**. {F1}{F2}
`;

const FIXTURE_DRAFT_ZH = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

规则写在 CLAUDE.md。{F1} Anthropic 也这样做（见文档）{F1}，代码 \`a。 b\` 保持原样。{O1}
`;

/** One fact with seven sources, then one sentence resting on three multi-source facts. */
const FIXTURE_CAPS = `---
title: "Caps fixture"
date: 2026-10-19
category: perspectives
excerpt: "Many sources."
---

One fact with seven sources. {F4}

Three facts in one sentence. {F4}{F5}{F6}
`;

/** The zh post cites S2 before S1: another first-use order than the en post's. */
const FIXTURE_CITES_ZH = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

Trace 记下标记，规则写在 CLAUDE.md。{F2}

Anthropic 也这样做。{F1}
`;

/** The zh post cites S1 before S2, the en post's order. */
const FIXTURE_CITES_ZH_SAME_ORDER = FIXTURE_CITES_ZH.replace(
  "{F2}\n\nAnthropic 也这样做。{F1}",
  "{F1}\n\nAnthropic 也这样做。{F2}",
);

/** Two published posts citing the same two sources, each numbered by its own first use. */
const FIXTURE_ORDER_EN = `---
title: "Order fixture"
date: 2026-10-19
category: perspectives
excerpt: "Two sources."
---

The first claim[^1]. The second claim[^2].

## More

The first claim again[^1].

[^1]: [One](https://example.com/one)
[^2]: [Two](https://example.com/two)
`;

const FIXTURE_ORDER_ZH = `---
title: "顺序样例"
date: 2026-10-19
category: perspectives
excerpt: "两个来源。"
---

第二条说法[^1]。第一条说法[^2]。

## 更多

第一条说法再次出现[^2]。

[^1]: [Two](https://example.com/two)
[^2]: [One](https://example.com/one)
`;

/** Labels that do not run 1, 2, … in first-use order: the site would show one number and jump to another. */
const FIXTURE_ORDER_BAD = FIXTURE_ORDER_EN.replace(
  "claim[^1]. The second claim[^2].",
  "claim[^2]. The second claim[^1].",
);

const FIXTURE_CITES_ZH_PARTIAL = FIXTURE_CITES_ZH.replace("CLAUDE.md。{F2}\n", "CLAUDE.md。\n");

/** A published zh post whose reference list does not match the en one. */
const FIXTURE_PUBLISHED_ZH_OTHER = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

规则写在别处[^1]。

[^1]: [Other](https://example.com/other)
`;

const FIXTURE_OUTLINE = (rowBudget) => `# Thesis
A marker in the Trace beats a gap.

# Reader and takeaway
Developers who read Traces.

# Title candidates
1. Self-test post

# Sections
## 0: (lead)
- The thesis. F1.
## 1: Where files go
- Where the archive lives. F1. Figure demo-flow.
## 2: What the Trace keeps
- The marker. F2. Figure demo-shot.
## 3: A marker beats a gap
- Our position. O1, F3.
## 4: What to read next
- The docs. F1 F2.

# Plan
| n | heading | words | facts | opinions | figures | ends with |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | (lead) | 60 | F1 | O1 | — | the scope sentence |
| 1 | Where files go | ${rowBudget} | F1 | — | demo-flow | a result |
| 2 | What the Trace keeps | ${rowBudget} | F2 | — | demo-shot | a question |
| 3 | A marker beats a gap | ${rowBudget} | F3 | O1 | — | a constraint |
| 4 | What to read next | ${rowBudget} | F1 F2 | — | — | a next step |
`;

/** A practice profile with a TL;DR, its budget apart from the lead's. */
const FIXTURE_PRACTICE_PROFILE = `# Profile: practice (fixture)

<!-- prompt -->
A practice post shows how something was built.
<!-- /prompt -->

## Check settings

- sections: 1-3
- lead: yes
- tldr: yes
- words: 100-850
- lead-words: 50-70
- section-words: 20-140
- tldr-words: 30-50
- zh-tldr-chars: 70-120
- body-lists: none
- body-tables: none
`;

const PRACTICE_LEAD =
  "Every change to request assembly runs the cache suites before it merges. The suites replay recorded requests and compare each one with the request before it. A miss names the tier that moved and the tokens it costs. The report reaches the agent that made the change. Nobody edits a number to make the suite pass again.";

const FIXTURE_PRACTICE = (bullets) => `---
title: "Practice fixture"
date: 2026-10-19
category: practice
excerpt: "A fixture for the TL;DR budget."
---

${PRACTICE_LEAD}

**TL;DR**

${bullets.map((b) => `- ${b}`).join("\n")}

## What the suite checks

The suite asserts one invariant: every request reads back the whole prefix of the request before it, unless a miss is listed by design with its reason.
`;

const TLDR_IN_RANGE = [
  "The suites run on three platforms for every core change.",
  "A miss reports the tier that moved and its token cost.",
  "A moved number goes to a person, never back into the test.",
];

const TLDR_OVER = [
  "The suites run on three platforms for every core change, on Linux, on macOS and on Windows, in the core shard.",
  "A miss reports the tier that moved, the request it moved in and the number of tokens it costs at the provider.",
  "A moved number goes to a person who decides what to do, and it never goes back into the test as a new baseline.",
];

const FIXTURE_FINDINGS = `1. [The Trace keeps a short marker.] — repeats the lead — concision — the section must add what the marker holds
2. [a sentence that is in no section] — vague — flow — the passage must be located first
3. [The format was settled early.] — vague — concision — the sentence must say when
`;

const FIXTURE_FIGURE = [
  '<figure class="post-figure" data-figure="demo-flow">',
  '  <svg class="fig-svg" viewBox="0 0 560 120" role="img" aria-labelledby="selftest-post-demo-flow-en-title">',
  '    <title id="selftest-post-demo-flow-en-title">Archived tool output moving to a path under the Project root.</title>',
  '    <text class="fig-label" x="10" y="40">&lt;root&gt;/&lt;project&gt;/</text>',
  '    <text class="fig-note" x="10" y="80"><tspan>[output archived: &lt;path&gt;]</tspan></text>',
  '    <text class="fig-tick" x="500" y="80">1</text>',
  "  </svg>",
  '  <ol class="fig-steps"><li>&lt;root&gt;/&lt;project&gt;/</li><li>[output archived: &lt;path&gt;]</li></ol>',
  "  <figcaption>The Trace keeps a marker where the output was.</figcaption>",
  "</figure>",
  "",
].join("\n");

/**
 * The selftest's stand-in for the gateway, run as its own process (the cases run synchronously):
 * it answers a chat completion with the file its URL path names, and 404 for any other path. It
 * exits when the selftest's end of its stdin closes, however the selftest ends.
 */
function standInGateway(http, fs, path, dir) {
  process.stdin.on("end", () => process.exit(0)).resume();
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const file = path.join(dir, path.basename(new URL(req.url, "http://127.0.0.1").pathname));
      if (!fs.existsSync(file)) {
        res.writeHead(404).end("no such answer");
        return;
      }
      const content = fs.readFileSync(file, "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "selftest",
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: {},
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
}

async function runSelftest() {
  const root = mkdtempSync(path.join(os.tmpdir(), "prose-selftest-"));
  const post = path.join(root, "selftest-post");
  const good = path.join(post, "figures");
  const bad = path.join(post, "figures-unescaped");
  const sections = path.join(post, "sections");
  const stray = path.join(post, "sections-stray");
  const long = path.join(post, "sections-long");
  for (const d of [good, bad, sections, stray, long]) mkdirSync(d, { recursive: true });
  const at = (name) => path.join(post, name);
  writeFileSync(at("facts.md"), FIXTURE_FACTS);
  writeFileSync(
    at("figures.md"),
    "| id | kind |\n| --- | --- |\n| demo-flow | flow |\n| demo-shot | screenshot |\n",
  );
  writeFileSync(at("draft.en.v1.md"), FIXTURE_DRAFT);
  writeFileSync(at("draft.zh.v1.md"), FIXTURE_DRAFT_ZH);
  writeFileSync(at("cites.zh.v1.md"), FIXTURE_CITES_ZH);
  writeFileSync(at("partial.zh.v1.md"), FIXTURE_CITES_ZH_PARTIAL);
  writeFileSync(at("same.zh.v1.md"), FIXTURE_CITES_ZH_SAME_ORDER);
  writeFileSync(at("caps.en.v1.md"), FIXTURE_CAPS);
  const capped = path.join(root, "caps", "caps.en.md");
  mkdirSync(path.dirname(capped), { recursive: true });
  const orderDir = path.join(root, "order");
  mkdirSync(orderDir, { recursive: true });
  writeFileSync(path.join(orderDir, "order.en.md"), FIXTURE_ORDER_EN);
  writeFileSync(path.join(orderDir, "order.zh.md"), FIXTURE_ORDER_ZH);
  writeFileSync(path.join(orderDir, "bad.en.md"), FIXTURE_ORDER_BAD);
  writeFileSync(at("outline.final.md"), FIXTURE_OUTLINE(100));
  writeFileSync(at("outline.over.md"), FIXTURE_OUTLINE(200));
  writeFileSync(at("findings.en.v1.md"), FIXTURE_FINDINGS);
  writeFileSync(path.join(good, "demo-flow.en.html"), FIXTURE_FIGURE);
  writeFileSync(
    path.join(bad, "demo-flow.en.html"),
    FIXTURE_FIGURE.replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
  );
  writeFileSync(
    at("strings.en.txt"),
    "hero.title: One harness for every agent\nhero.badge: Unlock it now!\n",
  );
  // The draft as the section step would have written it, one file per section.
  const split = splitSections(FIXTURE_DRAFT);
  split.forEach((s, n) => {
    const text =
      n === 0 ? `---\n${splitFrontmatter(FIXTURE_DRAFT).metaRaw}\n---\n${s.text}` : s.text;
    writeFileSync(path.join(sections, `s${n}.en.v1.md`), `${text.trim()}\n`);
  });
  // Section 2 carrying the figure that row 1 owns.
  writeFileSync(
    path.join(stray, "s2.en.v1.md"),
    `${split[2].text.trim()}\n\n${figureBlockTexts(FIXTURE_DRAFT).get("demo-flow")}\n`,
  );
  // Section 3 at twice the size its plan row allows.
  writeFileSync(
    path.join(long, "s3.en.v1.md"),
    `## A marker beats a gap\n\n${"We would rather keep a marker than leave a gap in the Trace. ".repeat(18).trim()} {O1}\n`,
  );
  writeFileSync(at("profile-blog-practice.md"), FIXTURE_PRACTICE_PROFILE);
  writeFileSync(at("practice.en.v1.md"), FIXTURE_PRACTICE(TLDR_IN_RANGE));
  writeFileSync(at("practice-over.en.v1.md"), FIXTURE_PRACTICE(TLDR_OVER));
  // A perspectives lead with no TL;DR, twice the size row 0 plans.
  writeFileSync(
    path.join(long, "s0.en.v1.md"),
    `---\ntitle: "Self-test post"\ndate: 2026-10-19\ncategory: perspectives\nexcerpt: "A fixture."\n---\n\n${PRACTICE_LEAD} ${PRACTICE_LEAD}\n`,
  );
  const practice = ["--profile", at("profile-blog-practice.md"), "--category", "practice"];
  // A lead that copied the prompt's "no version note" wording as a line of its own.
  const strayNote = path.join(post, "sections-stray-note");
  mkdirSync(strayNote, { recursive: true });
  writeFileSync(
    path.join(strayNote, "s0.en.v1.md"),
    `---\ntitle: "Self-test post"\ndate: 2026-10-19\ncategory: perspectives\nexcerpt: "A fixture."\n---\n\nNo version note.\n\n${PRACTICE_LEAD}\n`,
  );
  const published = path.join(root, "selftest-post.en.md");
  const publishedZh = path.join(root, "selftest-post.zh.md");
  const citedZh = path.join(root, "cites", "selftest-post.zh.md");
  mkdirSync(path.dirname(citedZh), { recursive: true });
  const otherZh = path.join(root, "other", "selftest-post.zh.md");
  mkdirSync(path.dirname(otherZh), { recursive: true });
  writeFileSync(otherZh, FIXTURE_PUBLISHED_ZH_OTHER);
  const assembled = at("draft.en.v2.md");
  // trim and fix: one directory per case, and the answer the stand-in gateway returns for it.
  const answers = path.join(root, "answers");
  const caseDir = (name, files) => {
    const dir = path.join(post, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
    return dir;
  };
  mkdirSync(answers, { recursive: true });
  const answer = (name, text) => writeFileSync(path.join(answers, name), text);
  const longS3 = readFileSync(path.join(long, "s3.en.v1.md"), "utf8");
  const gapSentence = "We would rather keep a marker than leave a gap in the Trace.";
  const trimOk = caseDir("trim-ok", { "s3.en.v1.md": longS3 });
  const trimOver = caseDir("trim-over", { "s3.en.v1.md": longS3 });
  answer("trim-ok.md", `## A marker beats a gap\n\n${gapSentence} {O1}\n`);
  answer("trim-over.md", `## A marker beats a gap\n\n${`${gapSentence} `.repeat(9).trim()} {O1}\n`);
  const flowBlock = figureBlockTexts(FIXTURE_DRAFT).get("demo-flow");
  const trimFigure = caseDir("trim-figure", {
    "s1.en.v1.md": `## Where files go\n\n${"Files live under one root per Project, and each archived output gets a file of its own. ".repeat(8).trim()} {F1}\n\n${flowBlock}\n`,
  });
  answer(
    "trim-figure.md",
    `## Where files go\n\nFiles live under one root per Project.\n\n${flowBlock.replace("<root>/<project>/", "<root>/")}\n`,
  );
  const s1 = `${split[1].text.trim()}\n`;
  const s2 = `${split[2].text.trim()}\n`;
  const shortMarker = "The Trace keeps a short marker. {F2}";
  const withF3 = s2.replace(
    shortMarker,
    "The Trace keeps a marker that names the archived file. {F2} The format was settled in a design review. {F3}",
  );
  const findingOnS2 =
    "1. [The Trace keeps a short marker.] — repeats the lead — concision — the section must add what the marker holds\n";
  const fixNew = caseDir("fix-new", { "s2.en.v1.md": s2, "findings.s2.en.v1.md": findingOnS2 });
  answer("fix-new.md", withF3);
  const fixNamed = caseDir("fix-named", {
    "s2.en.v1.md": s2,
    "findings.s2.en.v1.md":
      "1. [The Trace keeps a short marker.] — vague — F3 — the sentence must say the format was settled in a design review\n",
  });
  const fixShot = caseDir("fix-shot", { "s2.en.v1.md": s2, "findings.s2.en.v1.md": findingOnS2 });
  answer(
    "fix-shot.md",
    s2.replace(/(caption: The marker names[^\n]*)/, "$1\ntext:\n- note: archived"),
  );
  const fixFlow = caseDir("fix-flow", {
    "s1.en.v1.md": s1,
    "findings.s1.en.v1.md":
      "1. [Files live under one root per Project.] — vague — concision — the sentence must name the root\n",
  });
  answer("fix-flow.md", s1.replace("[output archived: <path>]", "[archived: <path>]"));
  // A page whose every section sits just under its own cap and over the page's together.
  const words = (k) => `${Array(k).fill("word").join(" ")}.`;
  const creep = caseDir("creep", {
    "s0.en.v1.md": `---\ntitle: "Creep"\ndate: 2026-10-19\ncategory: perspectives\nexcerpt: "A fixture."\n---\n\n${words(65)}\n`,
    ...Object.fromEntries(
      ["Alpha", "Beta", "Gamma", "Delta"].map((h, i) => [
        `s${i + 1}.en.v1.md`,
        `## ${h}\n\n${words(108)}\n`,
      ]),
    ),
  });
  // A lead with the version note, over its row, and two answers that rewrite or drop the note.
  const note = "Written for PenguinHarness 0.2.16. Later releases may differ in some details.";
  const front = `---\ntitle: "Self-test post"\ndate: 2026-10-19\ncategory: perspectives\nexcerpt: "A fixture."\n---\n\n`;
  const noted = `${front}> ${note}\n\n${PRACTICE_LEAD} ${PRACTICE_LEAD}\n`;
  const trimNote = caseDir("trim-note", { "s0.en.v1.md": noted });
  answer("trim-note.md", `${front}> Written for PenguinHarness 0.2.16.\n\n${PRACTICE_LEAD}\n`);
  const polishNote = caseDir("polish-note", { "s0.en.v1.md": noted });
  answer("polish-note.md", `${front}${PRACTICE_LEAD} ${PRACTICE_LEAD}\n`);
  // Autolinks are links; a span is HTML; a bare URL before a marker loses its citation on the site.
  writeFileSync(
    at("autolink.en.v1.md"),
    `${front}The docs are at <https://penguin.ooo/docs/agent-loop>. {F1}\n\nWrite to <mailto:team@penguin.ooo> with questions.\n\nA <span>tag</span> is still HTML.\n\nOr read https://penguin.ooo/docs/agent-loop. {F1}\n`,
  );
  // A fix's answer as check reads it: the screenshot's block with a string list.
  const shotText = caseDir("shot-text", {
    "s2.en.v1.md": s2.replace(/(caption: The marker names[^\n]*)/, "$1\ntext:\n- note: archived"),
  });
  // Citation scopes and placement: every source once per post, a paragraph at most once (its
  // other new source stays free for the next paragraph), a NOCITE fact never; outside a closing
  // quote, or after it when the quote holds the period.
  writeFileSync(
    at("scopes.en.v1.md"),
    `${front}The archive has a format. {F4}\nIt has a marker too. {F4}\n\n## One\n\nThe format again, in a new section. {F4}\nOur docs say so. {F1}\nBackground only. {F6}\n\n## Two\n\nOur docs again. {F1}\nThey call it "the slope". {F5}\nThe writer keeps it. {F2}\n\nIt "works." {F2}\n`,
  );
  const scoped = path.join(root, "scopes", "scopes.en.md");
  mkdirSync(path.dirname(scoped), { recursive: true });
  const stripScopes = [
    "strip",
    "--in",
    at("scopes.en.v1.md"),
    "--out",
    scoped,
    "--facts",
    at("facts.md"),
  ];
  // Published posts: a citation after the period; three citations in one paragraph, two in one
  // sentence; fourteen sources, one more than the profile's cap.
  const defs = (k) =>
    Array.from(
      { length: k },
      (_, i) => `[^${i + 1}]: [Source ${i + 1}](https://example.com/s${i + 1})`,
    ).join("\n");
  writeFileSync(at("after-punct.en.md"), `${front}The first claim.[^1]\n\n${defs(1)}\n`);
  writeFileSync(
    at("dense.en.md"),
    `${front}Short[^1]. This has two[^2] and more[^3].\n\n${defs(3)}\n`,
  );
  writeFileSync(
    at("many-sources.en.md"),
    `${front}${Array.from({ length: 14 }, (_, i) => `Claim ${i + 1}[^${i + 1}].`).join("\n\n")}\n\n${defs(14)}\n`,
  );
  // Sentences over the cap, in a section file each, so no page-level rule fires.
  const longEn = caseDir("long-sentence", { "s1.en.v1.md": `## Long\n\n${words(40)}\n` });
  const longZh = caseDir("long-sentence-zh", {
    "s1.zh.v1.md": `## 长句\n\n${"字".repeat(70)}。\n`,
  });
  const glossary = caseDir("glossary", {
    "s1.zh.v1.md": "## 术语\n\n我们的合成夹具测试跑在 agent harness 上，线形态不变。\n",
  });
  // emphasize: the plain draft in, and answers that keep the text, change it, miscount or misplace.
  const plain = FIXTURE_DRAFT.replace(/\*\*/g, "");
  // The fixture's spans mark parts of sentences; an answer marks whole ones.
  const wholeEmph = plain
    .replace("Archived output keeps", "**Archived output keeps")
    .replace("in the Trace. {F1}", "in the Trace**. {F1}")
    .replace("Files live under one root per Project.", "**Files live under one root per Project**.")
    .replace("The Trace keeps a short marker.", "**The Trace keeps a short marker**.")
    .replace(
      "We would rather keep a marker than leave a gap.",
      "**We would rather keep a marker than leave a gap**.",
    )
    .replace(
      "The docs describe the archive in full.",
      "**The docs describe the archive in full**.",
    );
  const emphOk = caseDir("emph-ok", { "draft.en.v1.md": plain });
  answer("emph-ok.md", wholeEmph);
  const emphClause = caseDir("emph-clause", { "draft.en.v1.md": plain });
  answer("emph-clause.md", FIXTURE_DRAFT);
  const emphText = caseDir("emph-text", { "draft.en.v1.md": plain });
  answer("emph-text.md", FIXTURE_DRAFT.replace("keeps its place", "holds its place"));
  const twoAndNone = FIXTURE_DRAFT.replace(
    "Files live under **one root per Project**.",
    "**Files live** under **one root per Project**.",
  ).replace("The docs describe **the archive in full**.", "The docs describe the archive in full.");
  const emphCount = caseDir("emph-count", { "draft.en.v1.md": plain });
  answer("emph-count.md", twoAndNone);
  const longClaim =
    "We keep every archived output on disk under the Project root and keep a short marker in the Trace so that a reader can find the full output again later";
  const emphCap = caseDir("emph-cap", {
    "draft.en.v1.md": `${front}The archive keeps its place. {F1}\n\n## Long\n\n${longClaim}. {F2}\n`,
  });
  answer(
    "emph-cap.md",
    `${front}**The archive keeps its place. {F1}**\n\n## Long\n\n**${longClaim}**. {F2}\n`,
  );
  writeFileSync(
    at("emph-rules.en.v1.md"),
    twoAndNone.replace(
      "We would rather **keep a marker than leave a gap**. {O1}",
      "We would rather **keep a marker than leave a gap. {O1}**",
    ),
  );
  // pair: the lead stresses other numbers, and section 1 is stressed in one language only.
  const zhFront = `---\ntitle: "自检文章"\ndate: 2026-10-19\ncategory: perspectives\nexcerpt: "样例。"\n---\n\n`;
  writeFileSync(
    at("stress.en.v1.md"),
    `${front}**3 claims** hold here.\n\n## More\n\n**The second point** stands.\n`,
  );
  writeFileSync(
    at("stress.zh.v1.md"),
    `${zhFront}**4 个结论**在这里成立。\n\n## 更多\n\n第二点成立。\n`,
  );
  const tldrPerspectives = caseDir("tldr-perspectives", {
    "s0.en.v1.md": `${front}${PRACTICE_LEAD}\n\n**TL;DR**\n\n${TLDR_IN_RANGE.map((b) => `- ${b}`).join("\n")}\n`,
  });
  // The page as assembled, with s1 pinned at v1 while a longer s1 v2 sits beside it.
  const creepFiles = Object.fromEntries(
    readdirSync(creep).map((name) => [name, readFileSync(path.join(creep, name), "utf8")]),
  );
  const pinned = caseDir("pinned", {
    ...creepFiles,
    "s1.en.v2.md": `## Beta\n\n${words(300)}\n`,
    "draft.en.v1.md": `${[0, 1, 2, 3, 4].map((k) => creepFiles[`s${k}.en.v1.md`].trim()).join("\n\n")}\n`,
  });
  // The closing ** before the sentence's punctuation, in both languages; and ** CommonMark cannot read.
  const emphEnOrder = caseDir("emph-en-order", {
    "draft.en.v1.md": `${front}Our view is simple. The rest follows from it. {O1}\n\n## Next\n\nOne more point stands here. {O1}\n`,
  });
  answer(
    "emph-en-order.md",
    `${front}**Our view is simple.** The rest follows from it. {O1}\n\n## Next\n\n**One more point stands here**. {O1}\n`,
  );
  const plainZh = `${zhFront}缓存命中靠前缀稳定。{F1}\n\n## 斜率\n\n每次请求都会把上下文变长。后面的请求更长。{F2}\n`;
  const markedZh = `${zhFront}**缓存命中靠前缀稳定**。{F1}\n\n## 斜率\n\n**每次请求都会把上下文变长**。后面的请求更长。{F2}\n`;
  const emphZhOk = caseDir("emph-zh-ok", { "draft.zh.v1.md": plainZh });
  answer("emph-zh-ok.md", markedZh);
  const emphZhMid = caseDir("emph-zh-mid", {
    "draft.zh.v1.md": plainZh,
    "notes.md": "note: in the lead, mark the sentence on what makes cache hits\n",
  });
  answer(
    "emph-zh-mid.md",
    markedZh.replace("**缓存命中靠前缀稳定**。", "缓存命中靠**前缀稳定**。"),
  );
  const emphZhOrder = caseDir("emph-zh-order", { "draft.zh.v1.md": plainZh });
  answer(
    "emph-zh-order.md",
    markedZh.replace("**每次请求都会把上下文变长**。", "**每次请求都会把上下文变长。**"),
  );
  const flankZh = caseDir("flank-zh", {
    "s1.zh.v1.md": "## 标题\n\n**关键句。**后文接着说。\n\n**关键句**。后文接着说。\n",
  });
  const flankEn = caseDir("flank-en", {
    "s1.en.v1.md": "## Title\n\nA word**(aside)** here.\n\nA word **(aside)** here.\n",
  });
  // The TL;DR sums up the body: its markers cite nothing, so the body's first use sets the numbers.
  writeFileSync(
    at("tldr-cite.en.v1.md"),
    `${front}Our view comes first. {O1}\n\n**TL;DR**\n\n- Point one. {F5}\n- Point two. {F4}\n- Point three. {O1}\n\n## One\n\nBody four. {F4}\n\nBody five. {F5}\n`,
  );
  const tldrCited = path.join(root, "tldr", "tldr-cite.en.md");
  mkdirSync(path.dirname(tldrCited), { recursive: true });
  writeFileSync(
    at("tldr-post.en.md"),
    `${front}Lead text here.\n\n**TL;DR**\n\n- Point one[^1].\n- Point two.\n- Point three.\n\n${defs(1)}\n`,
  );
  // A UI label in bold beside the section's emphasized sentence; a profile file named by category.
  writeFileSync(
    at("bold-label.en.v1.md"),
    FIXTURE_DRAFT.replace(
      "The Trace keeps a short marker. {F2}",
      "Open **Trace view** to see a short marker. {F2}",
    ),
  );
  writeFileSync(at("profile-practice.md"), FIXTURE_PRACTICE_PROFILE);
  // Whole-post mode: write's guards and after-report, trim and fix on a whole draft, review's
  // transitions line, translate's pinned title.
  const writeArgs = (dir, extra = []) => [
    "write",
    "--outline",
    at("outline.final.md"),
    "--figures",
    at("figures.md"),
    ...facts,
    "--out",
    path.join(dir, "draft.en.v1.md"),
    ...extra,
  ];
  const writeOk = caseDir("write-ok", {
    "notes.md": "keep: keeps its place in the Trace\nnote: the archive is not compressed\n",
  });
  answer("write-ok.md", plain);
  const writeNote = caseDir("write-note", {});
  const writeNotes = caseDir("write-notes", {
    "notes.md": "keep: a sentence that is not there\navoid en: short marker\navoid zh: 短标记\n",
  });
  const writeHard = caseDir("write-hard", {});
  answer(
    "write-hard.md",
    FIXTURE_DRAFT.replace(
      "Archived output **keeps its place in the Trace**. {F1}",
      "Archived output **keeps its place in the Trace**[^1]. {F1}",
    ),
  );
  const flowBlock2 = figureBlockTexts(plain).get("demo-flow");
  const filler = "We keep a marker in the Trace so the reader can find the output again later. ";
  const longGap = `We would rather keep a marker than leave a gap. {O1} ${filler.repeat(14).trim()} The format was settled early {F3}.`;
  const shortGap =
    "We would rather keep a marker than leave a gap. {O1} The format was settled early {F3}.";
  const writeAfterDir = caseDir("write-after", {});
  answer(
    "write-after.md",
    plain
      .replace(`${flowBlock2}\n\n`, "")
      .replace(
        "caption: The marker names the file as <path> and the id as `<id>`.\n```",
        `caption: The marker names the file as <path> and the id as \`<id>\`.\n\`\`\`\n\n${flowBlock2}`,
      )
      .replace(shortGap, longGap),
  );
  const trimDocOk = caseDir("trim-doc-ok", { "draft.en.v1.md": plain.replace(shortGap, longGap) });
  const trimDocBad = caseDir("trim-doc-bad", {
    "draft.en.v1.md": plain.replace(shortGap, longGap),
  });
  // Section 3 at 239 words, cap 160: the aim is 152 and the floor 144, whatever its plan row says.
  const gapOf = (k) =>
    `We would rather keep a marker than leave a gap. {O1} ${filler.repeat(k).trim()} The format was settled early {F3}.`;
  answer("trim-doc-ok.md", plain.replace(shortGap, gapOf(9)));
  const trimDocOver = caseDir("trim-doc-over", {
    "draft.en.v1.md": plain.replace(shortGap, longGap),
  });
  answer("trim-doc-over.md", plain.replace(shortGap, gapOf(7)));
  const trimDocShot = caseDir("trim-doc-shot", {
    "draft.en.v1.md": plain.replace(shortGap, longGap),
  });
  answer(
    "trim-doc-shot.md",
    plain
      .replace(shortGap, gapOf(9))
      .replace(/(caption: The marker names[^\n]*)/, "$1\ntext:\n- note: archived"),
  );
  const trimNumber = caseDir("trim-number", {
    "s3.en.v1.md": `## A marker beats a gap\n\n${"We would rather keep a marker than leave a gap in the Trace. ".repeat(18).trim()} The archive holds 42 files. {O1}\n`,
  });
  answer(
    "trim-number.md",
    "## A marker beats a gap\n\nWe would rather keep a marker than leave a gap in the Trace. The archive holds many files. {O1}\n",
  );
  // Every section within its cap and the page over its own: a share of the cut for each section.
  const trimPage = caseDir("trim-page", {
    "draft.en.v1.md": `${front}${words(70)}\n${["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((h) => `\n## ${h}\n\n${words(150)}\n`).join("")}`,
  });
  answer(
    "trim-doc-bad.md",
    plain.replace("Files live under one root per Project.", "Files live under a root."),
  );
  const fixDoc = caseDir("fix-doc", { "draft.en.v1.md": plain, "findings.en.v1.md": findingOnS2 });
  answer("fix-doc.md", plain.replace("## Where files go", "## Where the files live"));
  const advisory = caseDir("advisory", {
    "s3.en.v1.md": `## A marker beats a gap\n\n${words(130)}\n`,
  });
  const signEn = caseDir("signpost-en", {
    "s1.en.v1.md": "## The intercept\n\nNext, we cut the intercept.\n",
  });
  const signZh = caseDir("signpost-zh", { "s1.zh.v1.md": "## 截距\n\n接下来我们看斜率。\n" });
  const reviewFlow = caseDir("review-flow", { "draft.en.v1.md": plain });
  answer(
    "review-flow.md",
    "1. [The Trace keeps a short marker.] — repeats the lead — concision — the section must add what the marker holds\ntransitions: 3 of 4\n",
  );
  const fixOutline = caseDir("fix-outline", {
    "outline.final.md": FIXTURE_OUTLINE(100),
    "findings.md":
      "1. [Where files go] — vague — concision — the heading must say where the files live\n",
  });
  answer(
    "fix-outline.md",
    FIXTURE_OUTLINE(100).replace("| 1 | Where files go |", "| 1 | Where the files live |"),
  );
  const trTitle = caseDir("tr-title", { "draft.zh.v1.md": FIXTURE_DRAFT_ZH });
  answer(
    "tr-title.md",
    `${front}The rules live in CLAUDE.md. {F1} Anthropic does the same {F1}, and the code \`a。 b\` stays. {O1}\n`,
  );
  // unstrip: the fixture published, then recovered into a folder named by its slug; a pair of
  // published posts recovered with aligned ids; a drawing with two strings no block can hold.
  const roundPost = path.join(root, "roundtrip", "selftest-post.en.md");
  const roundDir = path.join(root, "recovered", "selftest-post");
  const roundAgain = path.join(root, "roundtrip", "again", "selftest-post.en.md");
  mkdirSync(path.dirname(roundAgain), { recursive: true });
  const orderOut = path.join(root, "recovered", "order");
  // An essay's body is prose: a list after the TL;DR's own list, and a table.
  writeFileSync(
    at("body-list.en.v1.md"),
    `${front}Lead text. {O1}\n\n**TL;DR**\n\n- One. {O1}\n- Two. {O1}\n- Three. {O1}\n\n## One\n\nA paragraph. {O1}\n\n- a body item\n- another item\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`,
  );
  // A docs page for the review's prompt: lists allowed, no key sentences.
  writeFileSync(at("page.en.v1.md"), `---\ntitle: "Page"\ndescription: "A page."\n---\n\nText.\n`);
  // A hand edit strip would not make: curly quotes in English prose, which strip straightens.
  const curly = path.join(root, "curly", "selftest-post.en.md");
  mkdirSync(path.dirname(curly), { recursive: true });
  writeFileSync(
    curly,
    `${front}He said “hi” to the archive[^1].\n\n[^1]: [Source 1](https://example.com/s1)\n`,
  );
  const twoTitles = path.join(root, "two-titles", "selftest-post.en.md");
  mkdirSync(path.dirname(twoTitles), { recursive: true });
  const inlineFigure = FIXTURE_FIGURE.split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  writeFileSync(
    twoTitles,
    `${front}Lead.\n\n${inlineFigure.replace('<text class="fig-tick"', '<text class="fig-title">One</text><text class="fig-title">Two</text><text class="fig-tick"')}\n`,
  );

  // transition: a draft with a TL;DR before the first heading, a figure and a middle paragraph in
  // the first section, and answers that mend the joins or change what they may not.
  const joinDraft = `${front}Lead one. {F1} The lead ends here. {F1}\n\n**TL;DR**\n\n- Point one. {F1}\n- Point two. {F2}\n- Point three. {O1}\n\n## First\n\nFirst opens here. {F1} More of first. {F1}\n\n${flowBlock2}\n\nA middle paragraph. {F2}\n\nFirst closes. The last sentence of first. {F2}\n\n## Second\n\nSecond opens here. {O1} Rest of second. {O1}\n`;
  const joinCase = (name, answerText) => {
    const dir = caseDir(name, { "draft.en.v1.md": joinDraft });
    if (answerText !== undefined) answer(`${name}.md`, answerText);
    return dir;
  };
  const joinOkText = joinDraft
    .replace("First opens here. {F1}", "The points start with where the archive lives. {F1}")
    .replace(
      "The last sentence of first. {F2}",
      "The last sentence of first hands the marker to second. {F2}",
    );
  const joinOk = joinCase("join-ok", joinOkText);
  // The fence the prompt put around the text, echoed as a lone closing line.
  const joinFence = joinCase("join-fence", `${joinOkText}\`\`\`\`\n`);
  const emphFence = caseDir("emph-fence", { "draft.en.v1.md": plain });
  answer("emph-fence.md", `\`\`\`\`markdown\n${wholeEmph}`);
  const joinMiddle = joinCase(
    "join-middle",
    joinDraft.replace("A middle paragraph. {F2}", "A middle paragraph, reworded. {F2}"),
  );
  const joinMarker = joinCase(
    "join-marker",
    joinDraft.replace("Second opens here. {O1}", "Second opens from the marker."),
  );
  const joinHeading = joinCase("join-heading", joinDraft.replace("## Second", "## The second"));
  const joinFigure = joinCase(
    "join-figure",
    joinDraft.replace("<root>/<project>/", "<root>/").replace("First opens here.", "First opens."),
  );
  const joinTldr = joinCase(
    "join-tldr",
    joinDraft.replace("- Point three. {O1}", "- Point three leads on. {O1}"),
  );
  writeFileSync(
    path.join(joinOk, "findings.en.v1.md"),
    "1. [First opens here.] — does not follow the TL;DR — transition — the sentence must pick up the last point\n2. [More of first.] — vague — concision — the sentence must say more\n",
  );

  const self = fileURLToPath(import.meta.url);
  const facts = ["--facts", at("facts.md")];
  const cases = [
    {
      name: "angle-bracket placeholders in figure strings are data, and an escaped drawing matches them",
      args: [
        "check",
        "--in",
        at("draft.en.v1.md"),
        ...facts,
        "--figures",
        at("figures.md"),
        "--svg",
        good,
      ],
      code: 0,
      stdout: /no reference will be rendered for \{F3\}/,
    },
    {
      name: "a drawing that leaves <path> unescaped does not match its block",
      args: ["check", "--in", at("draft.en.v1.md"), "--svg", bad],
      code: 1,
      stdout: /is not drawn as a <text>\/<tspan> leaf/,
    },
    {
      name: "strip refuses to inline an unescaped drawing",
      args: ["strip", "--in", at("draft.en.v1.md"), "--out", published, "--figures-dir", bad],
      code: 1,
      stderr: /does not match figure demo-flow/,
    },
    {
      name: "figure keys with digits (step1, config2) are keys, not part of the string",
      args: ["check", "--in", at("draft.en.v1.md"), "--svg", good],
      code: 0,
      stdout: /0 errors/,
    },
    {
      name: "strip cites before the punctuation and outside the bold, our own sources once per post, private sources and opinions never",
      args: [
        "strip",
        "--in",
        at("draft.en.v1.md"),
        "--out",
        published,
        "--figures-dir",
        good,
        ...facts,
      ],
      code: 0,
      file: [
        published,
        /keeps its place in the Trace\*\*\[\^1\]\.\n[\s\S]*Files live under \*\*one root per Project\*\*\.\n[\s\S]*The Trace keeps a short marker\[\^2\]\.[\s\S]*The format was settled early\.\n[\s\S]*\*\*the archive in full\*\*\.\n\n\[\^1\]: \[PenguinHarness docs: Agent loop\]\(https:\/\/penguin\.ooo\/docs\/agent-loop\)\n\[\^2\]: \[packages\/core\/src\/trace\/writer\.ts\]\(https:\/\/github\.com\/Prism-Shadow\/penguin-harness\/blob\/v0\.2\.16\/packages\/core\/src\/trace\/writer\.ts\)\n$/,
      ],
    },
    {
      name: "strip inlines the drawing on one line and escapes a screenshot caption outside code spans",
      args: [
        "strip",
        "--in",
        at("draft.en.v1.md"),
        "--out",
        published,
        "--figures-dir",
        good,
        ...facts,
      ],
      code: 0,
      file: [
        published,
        /\n<figure class="post-figure" data-figure="demo-flow">[^\n]*<\/figure>\n[\s\S]*_The marker names the file as &lt;path&gt; and the id as `<id>`\._/,
      ],
    },
    {
      name: "strip straightens curly quotes in English prose but not in code spans",
      args: [
        "strip",
        "--in",
        at("draft.en.v1.md"),
        "--out",
        published,
        "--figures-dir",
        good,
        ...facts,
      ],
      code: 0,
      file: [published, /The writer's "marker" is kept, and `it’s` \*\*stays in code\*\*\.\n/],
    },
    {
      name: "the stripped post passes, its figure and its footnotes checked against the draft and SOURCES",
      args: ["check", "--in", published, "--draft", at("draft.en.v1.md"), ...facts],
      code: 0,
    },
    {
      name: "strip leaves no space where a marker sat after CJK punctuation, outside code spans",
      args: ["strip", "--in", at("draft.zh.v1.md"), "--out", publishedZh],
      code: 0,
      file: [publishedZh, /CLAUDE\.md。Anthropic 也这样做（见文档），代码 `a。 b` 保持原样。\n/],
    },
    {
      name: "--numbering-from reproduces the other language's numbers when the order matches",
      args: [
        "strip",
        "--in",
        at("same.zh.v1.md"),
        "--out",
        citedZh,
        ...facts,
        "--numbering-from",
        published,
      ],
      code: 0,
      file: [
        citedZh,
        /CLAUDE\.md\[\^1\]。\n\nAnthropic 也这样做\[\^2\]。\n\n\[\^1\]: \[PenguinHarness docs/,
      ],
    },
    {
      name: "--numbering-from refuses a language that first cites the sources in another order",
      args: [
        "strip",
        "--in",
        at("cites.zh.v1.md"),
        "--out",
        citedZh,
        ...facts,
        "--numbering-from",
        published,
      ],
      code: 1,
      stderr:
        /it reaches \[\^2\] before \[\^1\][\s\S]*strip this language without --numbering-from/,
    },
    {
      name: "without --numbering-from the second language is numbered by its own first use",
      args: ["strip", "--in", at("cites.zh.v1.md"), "--out", citedZh, ...facts],
      code: 0,
      file: [
        citedZh,
        /CLAUDE\.md\[\^1\]。\n\nAnthropic 也这样做\[\^2\]。\n\n\[\^1\]: \[packages\/core\/src\/trace\/writer\.ts\]/,
      ],
    },
    {
      name: "a marker group cites one source, its fact's first public source",
      args: ["strip", "--in", at("caps.en.v1.md"), "--out", capped, ...facts],
      code: 0,
      file: [
        capped,
        /One fact with seven sources\[\^1\]\.\n[\s\S]*\n\[\^1\]: \[Write-up 4\][^\n]*\n\[\^2\]: \[Write-up 11\]/,
      ],
    },
    {
      name: "a sentence resting on three facts cites the first source not yet cited in the post",
      args: ["strip", "--in", at("caps.en.v1.md"), "--out", capped, ...facts],
      code: 0,
      file: [
        capped,
        /Three facts in one sentence\[\^2\]\.\n\n\[\^1\][^\n]*\n\[\^2\]: \[Write-up 11\]\(https:\/\/example\.com\/w11\)\n$/,
      ],
    },
    {
      name: "a published post whose labels are not in first-use order fails check",
      args: ["check", "--in", path.join(orderDir, "bad.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*footnote labels first appear in the order 2, 1/,
    },
    {
      name: "pair accepts the same sources numbered in each language's own first-use order",
      args: [
        "pair",
        "--in",
        path.join(orderDir, "order.en.md"),
        "--pair",
        path.join(orderDir, "order.zh.md"),
      ],
      code: 0,
    },
    {
      name: "--numbering-from rejects a source the other language cites and this one does not",
      args: [
        "strip",
        "--in",
        at("partial.zh.v1.md"),
        "--out",
        path.join(root, "partial.zh.md"),
        ...facts,
        "--numbering-from",
        published,
      ],
      code: 1,
      stderr: /source \[\^2\] of the --numbering-from post is never cited here/,
    },
    {
      name: "pair flags reference lists that differ",
      args: ["pair", "--in", published, "--pair", otherZh],
      code: 1,
      stdout: /the two posts cite different sources/,
    },
    {
      name: "a plan over its budget fails plan and writes the feedback for one rerun",
      args: ["plan", "--in", at("outline.over.md"), ...facts, "--figures", at("figures.md")],
      code: 1,
      stdout:
        /the rows sum to 860 words; the cap for the whole piece is 750[\s\S]*row 1 asks for 200 words/,
    },
    {
      name: "a sound plan passes and freezes",
      args: [
        "plan",
        "--in",
        at("outline.final.md"),
        ...facts,
        "--figures",
        at("figures.md"),
        "--freeze",
      ],
      code: 0,
      stdout: /froze/,
    },
    {
      name: "a section owning a figure its plan row does not give fails check --section",
      args: [
        "check",
        "--in",
        path.join(stray, "s2.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--figures",
        at("figures.md"),
      ],
      code: 1,
      stdout: /figure demo-flow is not in row 2 of the plan/,
    },
    {
      name: "a section over min(plan × 1.1, profile cap) is an error",
      args: ["check", "--in", path.join(long, "s3.en.v1.md"), "--outline", at("outline.final.md")],
      code: 1,
      stdout: /section 3 is 234 words; its cap is 110 \(plan 100, profile cap 160\)/,
    },
    {
      name: "a practice lead and its TL;DR are counted apart, each within its own budget",
      args: ["check", "--in", at("practice.en.v1.md"), ...practice],
      code: 0,
      notStdout: /the lead is \d+ words; its cap/,
    },
    {
      name: "a TL;DR over its own cap is an error, while the lead stays within its cap",
      args: ["check", "--in", at("practice-over.en.v1.md"), ...practice],
      code: 1,
      stdout: /the TL;DR is 67 words; its cap is 50/,
      notStdout: /the lead is \d+ words; its cap/,
    },
    {
      name: "a perspectives lead with no TL;DR is still held to its row (plan × 1.1)",
      args: ["check", "--in", path.join(long, "s0.en.v1.md"), "--outline", at("outline.final.md")],
      code: 1,
      stdout: /the lead is 114 words; its cap is 66 \(plan 60, profile cap 90\)/,
    },
    {
      name: "the lead's section call states the TL;DR budget apart when the profile has one",
      args: [
        "section",
        "--dry-run",
        "--outline",
        at("outline.final.md"),
        "--section",
        "0",
        ...facts,
        "--sections-dir",
        sections,
        ...practice,
      ],
      code: 0,
      stdout:
        /at most 60 English words of body text\. It is the lowest of: this section's planned size, 60 English words;[\s\S]*has its own, 30–50 English words, and is counted apart/,
    },
    {
      name: "a lead without a version note is told nothing about one",
      args: [
        "section",
        "--dry-run",
        "--outline",
        at("outline.final.md"),
        "--section",
        "0",
        ...facts,
        "--sections-dir",
        sections,
        "--version-note",
        "none",
      ],
      code: 0,
      notStdout: /version note|Nothing goes between/i,
    },
    {
      name: "a lead with a version note is told to reproduce it after the frontmatter",
      args: [
        "section",
        "--dry-run",
        "--outline",
        at("outline.final.md"),
        "--section",
        "0",
        ...facts,
        "--sections-dir",
        sections,
        "--version-note",
        "Written for PenguinHarness 0.2.16. Later releases may differ in some details.",
      ],
      code: 0,
      stdout:
        /with no heading\. Directly after the frontmatter, reproduce this line verbatim and then a blank line: > Written for PenguinHarness 0\.2\.16\./,
    },
    {
      name: 'a stray "No version note." line is an error',
      args: ["check", "--in", path.join(strayNote, "s0.en.v1.md")],
      code: 1,
      stdout: /a stray "No version note\." line/,
    },
    {
      name: "a section within its row passes check --section",
      args: [
        "check",
        "--in",
        path.join(sections, "s2.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        ...facts,
        "--figures",
        at("figures.md"),
      ],
      code: 0,
    },
    {
      name: "a section's dry run carries the sections before it and only its own facts",
      args: [
        "section",
        "--dry-run",
        "--outline",
        at("outline.final.md"),
        "--section",
        "2",
        ...facts,
        "--figures",
        at("figures.md"),
        "--sections-dir",
        sections,
      ],
      code: 0,
      stdout:
        /Sections already written[\s\S]*Files live under \*\*one root per Project\*\*\.[\s\S]*- F2: The Trace keeps a marker/,
      notStdout: /- F1: Archived tool output|- F3: The archive format/,
    },
    {
      name: "assemble joins the sections back into the draft, byte for byte",
      args: [
        "assemble",
        "--sections-dir",
        sections,
        "--lang",
        "en",
        "--out",
        assembled,
        "--outline",
        at("outline.final.md"),
      ],
      code: 0,
      file: [assembled, new RegExp(`^${FIXTURE_DRAFT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)],
    },
    {
      name: "route sends a finding to the section that quotes it and keeps the rest unrouted",
      args: ["route", "--findings", at("findings.en.v1.md"), "--sections-dir", sections],
      code: 0,
      stdout: /s2: 1 finding\(s\)[\s\S]*s3: 1 finding\(s\)[\s\S]*unrouted: 1 finding\(s\)/,
      file: [at("findings.s2.en.v1.md"), /^1\. \[The Trace keeps a short marker\.\]/],
    },
    {
      name: "a Chinese section on an English-word plan aims at the plan converted, not the plan's words, with the counting rule and an example it counted",
      args: [
        "section",
        "--dry-run",
        "--outline",
        at("outline.final.md"),
        "--section",
        "0",
        ...facts,
        "--sections-dir",
        sections,
        "--lang",
        "zh",
      ],
      code: 0,
      stdout:
        /at most 144 Chinese characters of body text\. It is the lowest of: this section's planned size, 144 Chinese characters; what the page has left, 840 Chinese characters \(its cap of 1800 less the 960 Chinese characters the rest of the page takes\); the profile's cap for the lead, 220 Chinese characters\. The plan counts English words: this section's planned size is its 60 English words at 2\.4 Chinese characters per English word\. The size check counts exactly this way[\s\S]*every remaining character that is not whitespace as one[\s\S]*"用 `check --svg` 核对 v0\.2\.16 的 2 张图，Agent 才不会漏掉。\{F3\}" counts as 36 characters/,
      notStdout: /the size the plan gives/,
    },
    {
      name: "a fix call aims at the planned size, not check's 1.1 × tolerance, and states the section's current size and the counting rule",
      args: [
        "fix",
        "--dry-run",
        "--in",
        path.join(long, "s3.en.v1.md"),
        "--findings",
        at("findings.en.v1.md"),
        ...facts,
        "--outline",
        at("outline.final.md"),
      ],
      code: 0,
      stdout:
        /at most 100 English words of body text\. It is the lowest of: this section's planned size, 100 English words; what the page has left, 336 English words \(its cap of 750 less the 414 English words the rest of the page takes\); the profile's cap for a section, 160 English words\. The section as given counts 234 English words\. The size check counts exactly this way[\s\S]*counts as 9 words/,
    },
    {
      name: "a whole docs page's call states its caps and the counting rule",
      args: [
        "write",
        "--dry-run",
        "--profile",
        "docs",
        "--outline",
        at("outline.final.md"),
        ...facts,
        "--lang",
        "en",
      ],
      code: 0,
      stdout:
        /at most 500 English words of body text in all, the lead at most 60 English words, and each `## ` section, everything under its heading, at most 120 English words\. The size check counts exactly this way/,
    },
    {
      name: "trim's prompt states the cap, the excess and what must stay byte for byte",
      args: [
        "trim",
        "--dry-run",
        "--in",
        path.join(long, "s3.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      code: 0,
      stdout:
        /at most 110 English words of body text, or the answer is refused\. The section given here counts 234 English words, so cut at least 124 English words\. Aim for at most 100 English words\. It is the lowest of: this section's planned size, 100 English words;[\s\S]*; 104 English words, a margin under the refusal cap\.[\s\S]*every fact marker `\{F#\}`[\s\S]*every figure block/,
    },
    {
      name: "trim writes a cut within the cap as the next version",
      args: ["trim", "--in", path.join(trimOk, "s3.en.v1.md"), "--outline", at("outline.final.md")],
      answer: "trim-ok.md",
      code: 0,
      stderr: /trim: section 3, 234 → 13 words of at most 110/,
      file: [
        path.join(trimOk, "s3.en.v2.md"),
        /^## A marker beats a gap\n\nWe would rather[^\n]*\{O1\}\n$/,
      ],
    },
    {
      name: "trim refuses an answer still over the cap and keeps it aside, not as the next version",
      args: [
        "trim",
        "--in",
        path.join(trimOver, "s3.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-over.md",
      code: 1,
      stderr: /still over its cap: 117 words > 110[\s\S]*kept as [^\n]*s3\.en\.v2\.rejected\.md/,
      absent: path.join(trimOver, "s3.en.v2.md"),
    },
    {
      name: "trim puts back a figure block the answer changed, and still refuses a dropped marker",
      args: [
        "trim",
        "--in",
        path.join(trimFigure, "s1.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-figure.md",
      code: 1,
      stderr:
        /figure demo-flow: the answer changed its block; the block given is kept[\s\S]*fact markers changed: dropped \[\{F1\}\], added \[\]/,
      absent: path.join(trimFigure, "s1.en.v2.md"),
    },
    {
      name: "fix refuses a marker that neither the section nor its findings name",
      args: [
        "fix",
        "--in",
        path.join(fixNew, "s2.en.v1.md"),
        "--findings",
        path.join(fixNew, "findings.s2.en.v1.md"),
        ...facts,
      ],
      answer: "fix-new.md",
      code: 1,
      stderr: /\{F3\} is new: neither the text given to fix nor its findings name F3/,
      absent: path.join(fixNew, "s2.en.v2.md"),
    },
    {
      name: "fix accepts a new marker its finding names",
      args: [
        "fix",
        "--in",
        path.join(fixNamed, "s2.en.v1.md"),
        "--findings",
        path.join(fixNamed, "findings.s2.en.v1.md"),
        ...facts,
      ],
      answer: "fix-new.md",
      code: 0,
      file: [path.join(fixNamed, "s2.en.v2.md"), /design review\. \{F3\}/],
    },
    {
      name: "fix refuses text: lines added to a screenshot's block",
      args: [
        "fix",
        "--in",
        path.join(fixShot, "s2.en.v1.md"),
        "--findings",
        path.join(fixShot, "findings.s2.en.v1.md"),
        ...facts,
      ],
      answer: "fix-shot.md",
      code: 1,
      stderr:
        /figure demo-shot is a screenshot's block \(alt and caption only\), and the answer gave it 1 text: string/,
    },
    {
      name: "fix refuses a changed figure block that no finding names",
      args: [
        "fix",
        "--in",
        path.join(fixFlow, "s1.en.v1.md"),
        "--findings",
        path.join(fixFlow, "findings.s1.en.v1.md"),
        ...facts,
      ],
      answer: "fix-flow.md",
      code: 1,
      stderr: /figure demo-flow changed, and no finding names it by its id or by quoting its text/,
    },
    {
      name: "check fails a string list in a block the manifest calls a screenshot",
      args: ["check", "--in", path.join(shotText, "s2.en.v1.md"), "--figures", at("figures.md")],
      code: 1,
      stdout:
        /ERROR [^\n]*figure demo-shot is a screenshot \("screenshot"\), whose block holds alt and caption only; it has a text: line and 1 string\(s\) under it/,
    },
    {
      name: "a fix call takes what the page has left as a ceiling when it is below the planned size",
      args: [
        "fix",
        "--dry-run",
        "--in",
        path.join(creep, "s4.en.v1.md"),
        "--findings",
        at("findings.en.v1.md"),
        ...facts,
        "--outline",
        at("outline.final.md"),
        "--word-budget",
        "480",
      ],
      code: 0,
      stdout:
        /at most 91 English words of body text\. It is the lowest of: this section's planned size, 100 English words; what the page has left, 91 English words \(its cap of 480 less the 389 English words the rest of the page takes\)/,
    },
    {
      name: "check --section warns when the sections, each within its own cap, put the page over its cap",
      args: [
        "check",
        "--in",
        path.join(creep, "s4.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--word-budget",
        "480",
      ],
      code: 0,
      stdout:
        /page 497 of at most 480 words\n[\s\S]*WARN [^\n]*the page is 497 words with this section; its cap is 480/,
    },
    {
      name: "trim refuses an answer that rewrites the version note",
      args: [
        "trim",
        "--in",
        path.join(trimNote, "s0.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-note.md",
      code: 1,
      stderr:
        /the version note changed: "> Written for PenguinHarness 0\.2\.16\." \(it was "> Written for PenguinHarness 0\.2\.16\. Later releases may differ in some details\."\)/,
      absent: path.join(trimNote, "s0.en.v2.md"),
    },
    {
      name: "polish refuses an answer that drops the version note",
      args: [
        "polish",
        "--in",
        path.join(polishNote, "s0.en.v1.md"),
        "--out",
        path.join(polishNote, "s0.en.v2.md"),
      ],
      answer: "polish-note.md",
      code: 1,
      stderr: /the version note "> Written for PenguinHarness 0\.2\.16\. [^"]*" is gone/,
      absent: path.join(polishNote, "s0.en.v2.md"),
    },
    {
      name: "autolinks, <https://…> and <mailto:…>, are links and not raw HTML; a span still is",
      args: ["check", "--in", at("autolink.en.v1.md")],
      code: 1,
      stdout: /autolink\.en\.v1\.md:12  raw HTML/,
      notStdout: /autolink\.en\.v1\.md:(8|10)  raw HTML/,
    },
    {
      name: "a bare URL right before a citation is an error",
      args: ["check", "--in", at("autolink.en.v1.md")],
      code: 1,
      stdout: /autolink\.en\.v1\.md:14  a bare URL right before a citation/,
    },
    {
      name: "an outside source is cited once per post, not again in a new section",
      args: stripScopes,
      code: 0,
      file: [
        scoped,
        /The archive has a format\[\^1\]\.\nIt has a marker too\.\n\n## One\n\nThe format again, in a new section\.\n/,
      ],
    },
    {
      name: "a paragraph cites once: its second new source waits for the next paragraph",
      args: stripScopes,
      code: 0,
      file: [
        scoped,
        /They call it "the slope"\[\^3\]\.\nThe writer keeps it\.\n\nIt "works\."\[\^4\]\n/,
      ],
    },
    {
      name: "our own sources are cited once per post",
      args: stripScopes,
      code: 0,
      file: [scoped, /Our docs say so\[\^2\]\.[\s\S]*Our docs again\.\n/],
    },
    {
      name: "a fact under ## NOCITE cites nothing",
      args: stripScopes,
      code: 0,
      file: [scoped, /Background only\.\n/],
    },
    {
      name: "a citation stands before the punctuation and outside a closing quote, after it when the quote holds the period",
      args: stripScopes,
      code: 0,
      file: [scoped, /They call it "the slope"\[\^3\]\.[\s\S]*It "works\."\[\^4\]\n/],
    },
    {
      name: "check reads a draft through the citer and warns where a quote holds the period",
      args: ["check", "--in", at("scopes.en.v1.md"), ...facts],
      code: 1,
      stdout: /WARN [^\n]*:23  a citation after a closing quote, bracket or bold/,
    },
    {
      name: "a published citation after the punctuation is an error",
      args: ["check", "--in", at("after-punct.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*a citation after the punctuation: it goes before it/,
    },
    {
      name: "a published paragraph with two citations is an error",
      args: ["check", "--in", at("dense.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*a paragraph with 3 citations \(one per paragraph at most\)/,
    },
    {
      name: "a published sentence with two citations is an error",
      args: ["check", "--in", at("dense.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*a sentence with 2 citations \(one per sentence at most\)/,
    },
    {
      name: "fewer sources than the profile's floor is a warning",
      args: ["check", "--in", at("dense.en.md")],
      code: 1,
      stdout: /WARN [^\n]*the post cites 3 sources, below the profile's floor of 6/,
    },
    {
      name: "more sources than the profile's cap is an error",
      args: ["check", "--in", at("many-sources.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*the post cites 14 sources; the profile allows at most 13/,
      notStdout: /a paragraph with/,
    },
    {
      name: "a draft read through the citer is held to the sources floor before it is stripped",
      args: ["check", "--in", at("scopes.en.v1.md"), ...facts],
      code: 1,
      stdout: /WARN [^\n]*strip would cite 4 sources, below the profile's floor of 6/,
      notStdout: /a paragraph with \d+ citations/,
    },
    {
      name: "check warns on an English sentence over 35 words",
      args: ["check", "--in", path.join(longEn, "s1.en.v1.md")],
      code: 0,
      stdout: /WARN [^\n]*a sentence of 40 words \(at most 35\)/,
    },
    {
      name: "check warns on a Chinese sentence over 60 characters",
      args: ["check", "--in", path.join(longZh, "s1.zh.v1.md")],
      code: 0,
      stdout: /WARN [^\n]*一句 71 字（最多 60 字）/,
    },
    {
      name: "zh: Harness is never 夹具, a lowercase harness is flagged, wire shape is not 线形态",
      args: ["check", "--in", path.join(glossary, "s1.zh.v1.md")],
      code: 1,
      stdout:
        /^(?=[\s\S]*ERROR [^\n]*译名：Harness 保持英文)(?=[\s\S]*WARN [^\n]*大小写：写作 Harness 或 Agent Harness)(?=[\s\S]*WARN [^\n]*译名：wire shape)/,
    },
    {
      name: "emphasize writes a draft that differs from its input only by one ** span per section",
      args: ["emphasize", "--in", path.join(emphOk, "draft.en.v1.md")],
      answer: "emph-ok.md",
      code: 0,
      file: [
        path.join(emphOk, "draft.en.v2.md"),
        /\*\*Archived output keeps its place in the Trace\*\*\. \{F1\}/,
      ],
    },
    {
      name: "emphasize refuses an answer that changes the text",
      args: ["emphasize", "--in", path.join(emphText, "draft.en.v1.md")],
      answer: "emph-text.md",
      code: 1,
      stderr: /line 8 differs once the \*\* are removed: "Archived output keeps its place/,
      absent: path.join(emphText, "draft.en.v2.md"),
    },
    {
      name: "emphasize refuses two spans in a section and none in another",
      args: ["emphasize", "--in", path.join(emphCount, "draft.en.v1.md")],
      answer: "emph-count.md",
      code: 1,
      stderr:
        /2 bold spans in section 1: bold marks the one key sentence, so write a UI label in quotes[\s\S]*no emphasized sentence in section 4/,
      absent: path.join(emphCount, "draft.en.v2.md"),
    },
    {
      name: "emphasize refuses a marker inside a span and a span over the cap",
      args: ["emphasize", "--in", path.join(emphCap, "draft.en.v1.md")],
      answer: "emph-cap.md",
      code: 1,
      stderr:
        /a fact marker inside the emphasis[\s\S]*an emphasized span of 30 words \(at most 25\)/,
      absent: path.join(emphCap, "draft.en.v2.md"),
    },
    {
      name: "emphasize --mirror shows the other language's marked draft and this language's cap",
      args: [
        "emphasize",
        "--dry-run",
        "--in",
        at("draft.zh.v1.md"),
        "--mirror",
        at("draft.en.v1.md"),
      ],
      code: 0,
      stdout:
        /at most 40 Chinese characters[\s\S]*The English edition of the same text is already marked[\s\S]*## The English edition, already marked \(read-only\)[\s\S]*\*\*keeps its place in the Trace\*\*/,
    },
    {
      name: "check holds an emphasized draft to one span per section, with no marker inside",
      args: ["check", "--in", at("emph-rules.en.v1.md")],
      code: 1,
      stdout:
        /^(?=[\s\S]*2 bold spans in section 1: bold marks the one key sentence)(?=[\s\S]*no emphasized sentence in section 4)(?=[\s\S]*a fact marker inside the emphasis)/,
    },
    {
      name: "pair wants the same sections stressed in both languages, and warns on other numbers",
      args: ["pair", "--in", at("stress.en.v1.md"), "--pair", at("stress.zh.v1.md")],
      code: 1,
      stdout:
        /the lead: the emphasized spans hold different numbers[\s\S]*section 1: 1 emphasized span\(s\) here, 0 in stress\.zh\.v1\.md/,
    },
    {
      name: "a perspectives lead may carry a TL;DR, counted apart",
      args: ["check", "--in", path.join(tldrPerspectives, "s0.en.v1.md")],
      code: 0,
      notStdout: /TL;DR/,
    },
    {
      name: "--page counts the other sections as the assembled draft holds them, not their newest files",
      args: [
        "check",
        "--in",
        path.join(pinned, "s4.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--word-budget",
        "480",
        "--page",
        path.join(pinned, "draft.en.v1.md"),
      ],
      code: 0,
      stdout: /page 497 of at most 480 words[\s\S]*the other sections from draft\.en\.v1\.md/,
    },
    {
      name: "emphasize refuses spans over part of a sentence",
      args: ["emphasize", "--in", path.join(emphClause, "draft.en.v1.md")],
      answer: "emph-clause.md",
      code: 1,
      stderr:
        /the span "keeps its place in the Trace" starts in the middle of its sentence; mark the whole sentence, from its first word/,
      absent: path.join(emphClause, "draft.en.v2.md"),
    },
    {
      name: "emphasize refuses a Chinese span that starts in the middle of its sentence",
      args: [
        "emphasize",
        "--in",
        path.join(emphZhMid, "draft.zh.v1.md"),
        "--notes",
        path.join(emphZhMid, "notes.md"),
      ],
      answer: "emph-zh-mid.md",
      code: 1,
      stderr: /the span "前缀稳定" starts in the middle of its sentence/,
      notStderr: /每次请求都会把上下文变长" (starts|ends)/,
      absent: path.join(emphZhMid, "draft.zh.v2.md"),
    },
    {
      name: "emphasize passes the author's notes as guidance on which sentence to mark",
      args: [
        "emphasize",
        "--dry-run",
        "--in",
        path.join(emphZhMid, "draft.zh.v1.md"),
        "--notes",
        path.join(emphZhMid, "notes.md"),
      ],
      code: 0,
      stdout:
        /Mark exactly one whole sentence[\s\S]*may say which sentence a section's span belongs on; follow them[\s\S]*## The author's notes \(binding\)[\s\S]*note: in the lead, mark the sentence on what makes cache hits[\s\S]*## The text to mark/,
    },
    {
      name: "emphasize refuses an English span closed after the sentence's period",
      args: ["emphasize", "--in", path.join(emphEnOrder, "draft.en.v1.md")],
      answer: "emph-en-order.md",
      code: 1,
      stderr: /line 8: the closing \*\* follows the sentence's punctuation/,
      absent: path.join(emphEnOrder, "draft.en.v2.md"),
    },
    {
      name: "emphasize accepts a Chinese span closed before the punctuation",
      args: ["emphasize", "--in", path.join(emphZhOk, "draft.zh.v1.md")],
      answer: "emph-zh-ok.md",
      code: 0,
      file: [path.join(emphZhOk, "draft.zh.v2.md"), /\*\*每次请求都会把上下文变长\*\*。后面/],
    },
    {
      name: "emphasize refuses a Chinese span closed after 。, which CommonMark cannot close",
      args: ["emphasize", "--in", path.join(emphZhOrder, "draft.zh.v1.md")],
      answer: "emph-zh-order.md",
      code: 1,
      stderr:
        /the closing \*\* follows the sentence's punctuation[\s\S]*a \*\* that cannot close emphasis/,
      absent: path.join(emphZhOrder, "draft.zh.v2.md"),
    },
    {
      name: "check: a ** after Chinese punctuation and before a character cannot close; before the punctuation it can",
      args: ["check", "--in", path.join(flankZh, "s1.zh.v1.md")],
      code: 1,
      stdout: /:3  a \*\* that cannot close emphasis/,
      notStdout: /:5  a \*\* that cannot/,
    },
    {
      name: "check: a ** after a letter and before punctuation cannot open; after a space it can",
      args: ["check", "--in", path.join(flankEn, "s1.en.v1.md")],
      code: 1,
      stdout: /:3  a \*\* that cannot open emphasis/,
      notStdout: /:5  a \*\* that cannot/,
    },
    {
      name: "the TL;DR cites nothing, so the body's first use sets the numbers",
      args: ["strip", "--in", at("tldr-cite.en.v1.md"), "--out", tldrCited, ...facts],
      code: 0,
      file: [
        tldrCited,
        /- Point one\.\n- Point two\.\n- Point three\.\n\n## One\n\nBody four\[\^1\]\.\n\nBody five\[\^2\]\.\n\n\[\^1\]: \[Write-up 4\]/,
      ],
    },
    {
      name: "a citation in a published TL;DR is an error",
      args: ["check", "--in", at("tldr-post.en.md")],
      code: 1,
      stdout: /ERROR [^\n]*a citation in the TL;DR/,
    },
    {
      name: "bold is the one emphasized sentence: a bold UI label beside it is an error that says to quote it",
      args: ["check", "--in", at("bold-label.en.v1.md")],
      code: 1,
      stdout:
        /ERROR [^\n]*2 bold spans in section 2: bold marks the one key sentence, so write a UI label in quotes/,
    },
    {
      name: "--profile <path> loads the profile its file name gives, not the default",
      args: [
        "check",
        "--in",
        path.join(long, "s3.en.v1.md"),
        "--profile",
        at("profile-practice.md"),
      ],
      code: 1,
      stdout: /\(en, blog-practice\)/,
    },
    {
      name: "trim with --page cuts a section within its own cap to what the page has left",
      args: [
        "trim",
        "--dry-run",
        "--in",
        path.join(pinned, "s4.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--word-budget",
        "480",
        "--page",
        path.join(pinned, "draft.en.v1.md"),
      ],
      code: 0,
      stdout: /at most 91 English words of body text, or the answer is refused/,
    },
    {
      name: "write writes a whole post that keeps its pinned title and the author's keep: line, and reports its sizes",
      args: writeArgs(writeOk, [
        "--title",
        "Self-test post",
        "--notes",
        path.join(writeOk, "notes.md"),
      ]),
      answer: "write-ok.md",
      code: 0,
      stderr: /page \d+ words of at most 750[\s\S]*next: check --in/,
      file: [path.join(writeOk, "draft.en.v1.md"), /^---\ntitle: "Self-test post"/],
    },
    {
      name: "write refuses an answer without its version note or with another title than the pinned one",
      args: writeArgs(writeNote, [
        "--version-note",
        "Written for PenguinHarness 0.2.16. Later releases may differ in some details.",
        "--title",
        "Another title",
      ]),
      answer: "write-ok.md",
      code: 1,
      stderr:
        /the version note "> Written for PenguinHarness 0\.2\.16\.[^"]*" is gone[\s\S]*the title is "Self-test post"; it must be "Another title"/,
      absent: path.join(writeNote, "draft.en.v1.md"),
    },
    {
      name: "write refuses an answer that lacks a keep: string or holds an avoid: string",
      args: writeArgs(writeNotes, ["--notes", path.join(writeNotes, "notes.md")]),
      answer: "write-ok.md",
      code: 1,
      stderr:
        /keep: "a sentence that is not there" is missing[\s\S]*avoid: "short marker" is in the answer/,
      absent: path.join(writeNotes, "draft.en.v1.md"),
    },
    {
      name: "write refuses a footnote and bold beyond the TL;DR line",
      args: writeArgs(writeHard),
      answer: "write-hard.md",
      code: 1,
      stderr: /a footnote \[\^…\][\s\S]*bold outside the \*\*TL;DR\*\* line/,
      absent: path.join(writeHard, "draft.en.v1.md"),
    },
    {
      name: "write's report names a figure out of manifest order and a section over its cap",
      args: writeArgs(writeAfterDir),
      answer: "write-after.md",
      code: 0,
      stderr:
        /figure demo-flow sits outside section 1[\s\S]*s3 +2\d\d words \/ plan 100 \/ cap 160  OVER[\s\S]*figure blocks \[demo-shot, demo-flow\]; the manifest gives \[demo-flow, demo-shot\]/,
    },
    {
      name: "trim on a whole draft cuts the section over its cap",
      args: [
        "trim",
        "--in",
        path.join(trimDocOk, "draft.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-doc-ok.md",
      code: 0,
      file: [
        path.join(trimDocOk, "draft.en.v2.md"),
        /We would rather keep a marker than leave a gap\. \{O1\} We keep a marker[\s\S]*The format was settled early \{F3\}\./,
      ],
    },
    {
      name: "a whole-draft trim names only the section over its cap and aims a little under the cap, not at its plan row",
      args: [
        "trim",
        "--dry-run",
        "--in",
        path.join(trimDocOk, "draft.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      code: 0,
      stdout:
        /rephrasing inside complete sentences[\s\S]*just enough to reach its aim, and stop there:\n- section 3 \("A marker beats a gap"\): now 239 English words; aim for about 152 English words; at most 160 English words and at least 144 English words\n[\s\S]*"many" stays "many" and never becomes "most"/,
      notStdout: /- (the lead|section [124] )/,
    },
    {
      name: "a whole-draft trim refuses an answer that cuts a section below its floor",
      args: [
        "trim",
        "--in",
        path.join(trimDocOver, "draft.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-doc-over.md",
      code: 1,
      stderr:
        /section 3 \("A marker beats a gap"\) was cut to 127 words, below its floor of 144: it was to land near 152/,
      absent: path.join(trimDocOver, "draft.en.v2.md"),
    },
    {
      name: "trim keeps a screenshot block as given when the answer adds text: lines to it",
      args: [
        "trim",
        "--in",
        path.join(trimDocShot, "draft.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-doc-shot.md",
      code: 0,
      stderr: /figure demo-shot: the answer changed its block; the block given is kept/,
      file: [
        path.join(trimDocShot, "draft.en.v2.md"),
        /caption: The marker names the file as <path> and the id as `<id>`\.\n```\n/,
      ],
    },
    {
      name: "trim refuses an answer that loses a number the text stated",
      args: [
        "trim",
        "--in",
        path.join(trimNumber, "s3.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-number.md",
      code: 1,
      stderr: /a number the text stated is gone: 42/,
      absent: path.join(trimNumber, "s3.en.v2.md"),
    },
    {
      name: "transition drops the lone fence line an answer echoes from the prompt",
      args: ["transition", "--in", path.join(joinFence, "draft.en.v1.md")],
      answer: "join-fence.md",
      code: 0,
      stderr: /dropped a stray fence line/,
      file: [path.join(joinFence, "draft.en.v2.md"), /Rest of second\. \{O1\}\n$/],
    },
    {
      name: "emphasize drops a lone opening fence line before its guard compares the text",
      args: ["emphasize", "--in", path.join(emphFence, "draft.en.v1.md")],
      answer: "emph-fence.md",
      code: 0,
      file: [path.join(emphFence, "draft.en.v2.md"), /^---\ntitle: "Self-test post"/],
    },
    {
      name: "a page over its cap shares the cut among the sections, down to a little under the page cap, and leaves the lead alone",
      args: ["trim", "--dry-run", "--in", path.join(trimPage, "draft.en.v1.md")],
      code: 0,
      stdout:
        /the page holds at most 750 English words of body text and counts 820 English words now[\s\S]*- section 1 \("Alpha"\): now 150 English words; aim for about 128 English words; at most 160 English words and at least 115 English words\n[\s\S]*- section 5 \("Epsilon"\): now 150 English words; aim for about 128/,
      notStdout: /- the lead:/,
    },
    {
      name: "trim on a whole draft refuses an answer that changes a section it was not asked to cut",
      args: [
        "trim",
        "--in",
        path.join(trimDocBad, "draft.en.v1.md"),
        "--outline",
        at("outline.final.md"),
      ],
      answer: "trim-doc-bad.md",
      code: 1,
      stderr:
        /section 1 \("Where files go"\) changed, but trim cuts only section 3 \("A marker beats a gap"\)/,
      absent: path.join(trimDocBad, "draft.en.v2.md"),
    },
    {
      name: "fix on a whole post refuses a changed heading that no finding quotes",
      args: [
        "fix",
        "--in",
        path.join(fixDoc, "draft.en.v1.md"),
        "--findings",
        path.join(fixDoc, "findings.en.v1.md"),
        ...facts,
        "--out",
        path.join(fixDoc, "draft.en.v2.md"),
      ],
      answer: "fix-doc.md",
      code: 1,
      stderr:
        /the heading "Where files go" became "Where the files live", and no finding quotes it or names a heading/,
      absent: path.join(fixDoc, "draft.en.v2.md"),
    },
    {
      name: "check --plan-rows advisory warns above plan × 1.1 within the profile's cap",
      args: [
        "check",
        "--in",
        path.join(advisory, "s3.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--plan-rows",
        "advisory",
      ],
      code: 0,
      stdout: /WARN [^\n]*section 3 is 130 words; its plan row is 100/,
    },
    {
      name: "check --plan-rows advisory still errors above the profile's cap",
      args: [
        "check",
        "--in",
        path.join(long, "s3.en.v1.md"),
        "--outline",
        at("outline.final.md"),
        "--plan-rows",
        "advisory",
      ],
      code: 1,
      stdout: /ERROR [^\n]*section 3 is 234 words; its cap is 160 \(the profile's\)/,
    },
    {
      name: "check warns on an English signpost",
      args: ["check", "--in", path.join(signEn, "s1.en.v1.md")],
      code: 0,
      stdout: /WARN [^\n]*signpost: a sentence that announces instead of continuing/,
    },
    {
      name: "check warns on a Chinese signpost",
      args: ["check", "--in", path.join(signZh, "s1.zh.v1.md")],
      code: 0,
      stdout: /WARN [^\n]*路标句/,
    },
    {
      name: "review keeps the transitions line out of the findings, in a .flow.txt beside them",
      args: ["review", "--in", path.join(reviewFlow, "draft.en.v1.md")],
      answer: "review-flow.md",
      code: 0,
      stderr: /transitions: 3 of 4/,
      files: [
        [
          path.join(reviewFlow, "findings.en.v1.api.md"),
          /^1\. \[The Trace keeps a short marker\.\][^\n]*\n$/,
        ],
        [path.join(reviewFlow, "findings.en.v1.api.md.flow.txt"), /^transitions: 3 of 4\n$/],
      ],
    },
    {
      name: "fix on an outline validates its plan instead of reporting it as a post",
      args: [
        "fix",
        "--in",
        path.join(fixOutline, "outline.final.md"),
        "--findings",
        path.join(fixOutline, "findings.md"),
        ...facts,
        "--out",
        path.join(fixOutline, "outline.v2.md"),
      ],
      answer: "fix-outline.md",
      code: 0,
      stderr: /plan: within budget/,
      notStderr: /page \d+ words|over a cap/,
    },
    {
      name: "translate refuses another title than the pinned one",
      args: [
        "translate",
        "--in",
        path.join(trTitle, "draft.zh.v1.md"),
        "--to",
        "en",
        ...facts,
        "--title",
        "Pinned title",
        "--out",
        path.join(trTitle, "draft.en.v1.md"),
      ],
      answer: "tr-title.md",
      code: 1,
      stderr: /the title is "Self-test post"; it must be "Pinned title"/,
      absent: path.join(trTitle, "draft.en.v1.md"),
    },
    {
      name: "unstrip: the fixture is published first, for the round trip",
      args: [
        "strip",
        "--in",
        at("draft.en.v1.md"),
        "--out",
        roundPost,
        "--figures-dir",
        good,
        ...facts,
      ],
      code: 0,
    },
    {
      name: "unstrip turns inline figures and screenshots into figure blocks and citations into markers, and its guard passes",
      args: ["unstrip", "--in", roundPost, "--out-dir", roundDir],
      code: 0,
      stdout:
        /1 drawn figure block\(s\) · 1 screenshot block\(s\) · 2 marker\(s\)[\s\S]*guard: every drawn figure matches its block/,
      files: [
        [
          path.join(roundDir, "recovered.en.md"),
          /keeps its place in the Trace\*\*\.\{F1\}\n[\s\S]*```figure id=demo-flow\nalt: Archived tool output moving to a path under the Project root\.\ncaption: The Trace keeps a marker where the output was\.\ntext:\n- s1: <root>\/<project>\/\n- s2: \[output archived: <path>\]\n```[\s\S]*The Trace keeps a short marker\.\{F2\}[\s\S]*```figure id=demo-shot\nalt: The Trace view showing an archived output\.\ncaption: The marker names the file as <path> and the id as `<id>`\.\n```/,
        ],
        [
          path.join(roundDir, "facts.en.seed.md"),
          /## SOURCES\n- S1: PenguinHarness docs: Agent loop · https:\/\/penguin\.ooo\/docs\/agent-loop\n- S2: packages\/core\/src\/trace\/writer\.ts · https:\/\/github\.com\/Prism-Shadow\/penguin-harness\/blob\/v0\.2\.16\/packages\/core\/src\/trace\/writer\.ts\n\n## FACTS\n- F1: Archived output keeps its place in the Trace\. \[S1\]\n- F2: The Trace keeps a short marker\. \[S2\]\n/,
        ],
        [
          path.join(roundDir, "figures", "demo-flow.en.html"),
          /^<figure class="post-figure" data-figure="demo-flow">[^\n]*<\/figure>\n$/,
        ],
      ],
    },
    {
      name: "unstrip: the recovered draft passes check --svg against the recovered figures",
      args: [
        "check",
        "--in",
        path.join(roundDir, "recovered.en.md"),
        "--facts",
        path.join(roundDir, "facts.en.seed.md"),
        "--svg",
        path.join(roundDir, "figures"),
      ],
      code: 0,
      stdout: /\b0 errors/,
    },
    {
      name: "unstrip: strip of the recovered draft with the seed gives back the published post byte for byte",
      args: [
        "strip",
        "--in",
        path.join(roundDir, "recovered.en.md"),
        "--out",
        roundAgain,
        "--facts",
        path.join(roundDir, "facts.en.seed.md"),
        "--figures-dir",
        path.join(roundDir, "figures"),
      ],
      code: 0,
      same: [roundAgain, roundPost],
    },
    {
      name: "unstrip refuses a draft",
      args: ["unstrip", "--in", at("draft.en.v1.md"), "--out-dir", path.join(root, "nope")],
      code: 2,
      stderr: /is a draft/,
    },
    {
      name: "unstrip refuses a drawing with two strings that are no step, since a block holds one title",
      args: ["unstrip", "--in", twoTitles, "--out-dir", path.join(root, "recovered", "two")],
      code: 1,
      stdout: /drawn text that is no step and not the one title: "Two"/,
    },
    {
      name: "body-lists: none makes a list in the body an error and leaves the TL;DR alone",
      args: ["check", "--in", at("body-list.en.v1.md")],
      code: 1,
      stdout:
        /ERROR [^\n]*:20  a list in the body: profile blog-perspectives writes the body in paragraphs/,
      notStdout: /:1[2-4]  a list in the body|a table in the body/,
    },
    {
      name: "review of a post fences the text apart from its instruction and expects the key sentences, the answered objection and the TL;DR as the only list",
      args: ["review", "--dry-run", "--in", at("draft.en.v1.md")],
      code: 0,
      stdout:
        /a list where a paragraph works \(in this post the TL;DR is the only list\)[\s\S]*softens the writer's own claim\. An objection stated fairly and then answered[\s\S]*one marked key sentence, in `\*\*`, in the lead and in each section are expected[\s\S]*everything between the two fence lines below, and nothing else\.\n\n````markdown\n---\ntitle: "Self-test post"[\s\S]*\*\*the archive in full\*\*\. \{F1\}\{F2\}\n````\n\nReview the text between the fence lines now\./,
      notStdout: /a paragraph where the content is a list|Review it now/,
    },
    {
      name: "review of a docs page keeps the paragraph-as-list point and says nothing of key sentences",
      args: ["review", "--dry-run", "--in", at("page.en.v1.md"), "--profile", "docs"],
      code: 0,
      stdout: /a list where a paragraph works, or a paragraph where the content is a list/,
      notStdout: /one marked key sentence/,
    },
    {
      name: "body-tables: none makes a table in the body an error",
      args: ["check", "--in", at("body-list.en.v1.md"), ...practice],
      code: 1,
      stdout:
        /ERROR [^\n]*:20  a list in the body[\s\S]*ERROR [^\n]*:23  a table in the body: profile blog-practice puts numbers in sentences/,
    },
    {
      name: "unstrip's guard refuses a post strip would not give back, such as a hand-typed curly quote",
      args: ["unstrip", "--in", curly, "--out-dir", path.join(root, "recovered", "curly")],
      code: 1,
      stdout: /ERROR line 8: strip gives back "He said "hi" to the archive\[\^1\]\."/,
    },
    {
      name: "unstrip: the first language of a pair, numbered by its own first use",
      args: ["unstrip", "--in", path.join(orderDir, "order.en.md"), "--out-dir", orderOut],
      code: 0,
      stderr: /next, the other language: unstrip --in \S*order\.zh\.md/,
      file: [
        path.join(orderOut, "facts.en.seed.md"),
        /- S1: One · https:\/\/example\.com\/one\n- S2: Two · https:\/\/example\.com\/two\n[\s\S]*- F3: The first claim again\. \[S1\]/,
      ],
    },
    {
      name: "unstrip --pair gives the second language the first's source ids and, section by section, its fact ids",
      args: [
        "unstrip",
        "--in",
        path.join(orderDir, "order.zh.md"),
        "--out-dir",
        orderOut,
        "--pair",
        path.join(orderOut, "recovered.en.md"),
        "--facts",
        path.join(orderOut, "facts.en.seed.md"),
      ],
      code: 0,
      files: [
        [
          path.join(orderOut, "recovered.zh.md"),
          /第二条说法。\{F2\}第一条说法。\{F1\}[\s\S]*第一条说法再次出现。\{F3\}/,
        ],
        [
          path.join(orderOut, "facts.zh.seed.md"),
          /- S1: One · https:\/\/example\.com\/one\n- S2: Two · https:\/\/example\.com\/two\n/,
        ],
      ],
    },
    {
      name: "unstrip: the two recovered drafts carry the same markers section by section",
      args: [
        "pair",
        "--in",
        path.join(orderOut, "recovered.en.md"),
        "--pair",
        path.join(orderOut, "recovered.zh.md"),
      ],
      code: 0,
      notStdout: /fact markers differ/,
    },
    {
      name: "transition on unstrip's recovered draft writes the first draft version beside it",
      args: ["transition", "--dry-run", "--in", path.join(roundDir, "recovered.en.md")],
      code: 0,
      stdout:
        /== transition \(en, blog-perspectives\)[^\n]*out \S*selftest-post\/draft\.en\.v1\.md ==/,
    },
    {
      name: "transition --dry-run sends the flow rule and only the review's join findings",
      args: [
        "transition",
        "--dry-run",
        "--in",
        path.join(joinOk, "draft.en.v1.md"),
        "--findings",
        path.join(joinOk, "findings.en.v1.md"),
      ],
      code: 0,
      stdout:
        /You edit the joins[\s\S]*one argument written in one sitting[\s\S]*## The review's findings on the joins\n1\. \[First opens here\.\][\s\S]*Edit the joins now\./,
      notStdout: /\[More of first\.\]/,
    },
    {
      name: "transition accepts a new first sentence after a heading and a new last sentence before one",
      args: ["transition", "--in", path.join(joinOk, "draft.en.v1.md")],
      answer: "join-ok.md",
      code: 0,
      stderr:
        /transition: 2 of 2 joins edited\n {2}## First: first after "First opens here\. \{F1\}" → "The points start with where the archive lives\. \{F1\}"\n {2}## Second: last before "The last sentence of first\. \{F2\}" → "The last sentence of first hands the marker to second\. \{F2\}"/,
      file: [path.join(joinOk, "draft.en.v2.md"), /hands the marker to second/],
    },
    {
      name: "transition refuses a change to a paragraph next to no heading",
      args: ["transition", "--in", path.join(joinMiddle, "draft.en.v1.md")],
      answer: "join-middle.md",
      code: 1,
      stderr: /the paragraph at line \d+ changed; transition rewrites only/,
      absent: path.join(joinMiddle, "draft.en.v2.md"),
    },
    {
      name: "transition refuses a rewritten sentence that dropped its marker",
      args: ["transition", "--in", path.join(joinMarker, "draft.en.v1.md")],
      answer: "join-marker.md",
      code: 1,
      stderr: /its first sentence carries no marker; it carried \{O1\}/,
      absent: path.join(joinMarker, "draft.en.v2.md"),
    },
    {
      name: "transition refuses a changed heading",
      args: ["transition", "--in", path.join(joinHeading, "draft.en.v1.md")],
      answer: "join-heading.md",
      code: 1,
      stderr: /the heading "## Second" changed/,
      absent: path.join(joinHeading, "draft.en.v2.md"),
    },
    {
      name: "transition puts back a figure string the answer changed and keeps the allowed edit beside it",
      args: ["transition", "--in", path.join(joinFigure, "draft.en.v1.md")],
      answer: "join-figure.md",
      code: 0,
      stderr: /figure demo-flow: the answer changed its block; the block given is kept/,
      file: [
        path.join(joinFigure, "draft.en.v2.md"),
        /First opens\. \{F1\}[\s\S]*- step1: <root>\/<project>\//,
      ],
    },
    {
      name: "transition refuses an edit to the TL;DR before a heading",
      args: ["transition", "--in", path.join(joinTldr, "draft.en.v1.md")],
      answer: "join-tldr.md",
      code: 1,
      stderr: /the TL;DR changed/,
      absent: path.join(joinTldr, "draft.en.v2.md"),
    },
    {
      name: "landing strings with a banned word and an exclamation mark fail",
      args: ["check", "--in", at("strings.en.txt"), "--profile", "landing"],
      code: 1,
      stdout: /marketing register: unlock[\s\S]*exclamation mark/,
    },
  ];

  // The API cases talk to a stand-in on a loopback port with a dummy key; a case without an
  // answer gets a path the stand-in refuses, so no case can reach the gateway or read the key.
  const gatewayFile = path.join(root, "gateway.mjs");
  writeFileSync(
    gatewayFile,
    `import http from "node:http";\nimport fs from "node:fs";\nimport path from "node:path";\n(${standInGateway})(http, fs, path, process.argv[2]);\n`,
  );
  const gateway = spawn(process.execPath, [gatewayFile, answers], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const port = await new Promise((resolve, reject) => {
    gateway.stdout.once("data", (d) => resolve(Number(String(d).trim())));
    gateway.once("exit", (code) => reject(new Error(`the stand-in gateway exited (${code})`)));
  });
  const env = { ...process.env, TOKENDANCE_API_KEY: "selftest" };
  delete env.TOKENDANCE_KEY_FILE;
  delete env.NODE_USE_ENV_PROXY;

  let failed = 0;
  try {
    for (const c of cases) {
      const res = spawnSync(process.execPath, [self, ...c.args], {
        encoding: "utf8",
        env: { ...env, PROSE_TEST_GATEWAY: `http://127.0.0.1:${port}/${c.answer ?? "none"}` },
      });
      const why = [];
      if (res.status !== c.code) why.push(`exit ${res.status}, expected ${c.code}`);
      if (c.stdout && !c.stdout.test(res.stdout)) why.push(`stdout lacks ${c.stdout}`);
      if (c.notStdout && c.notStdout.test(res.stdout)) why.push(`stdout has ${c.notStdout}`);
      if (c.notStderr && c.notStderr.test(res.stderr)) why.push(`stderr has ${c.notStderr}`);
      if (c.stderr && !c.stderr.test(res.stderr)) why.push(`stderr lacks ${c.stderr}`);
      for (const [file, re] of c.files ?? (c.file ? [c.file] : [])) {
        if (!(existsSync(file) && re.test(readFileSync(file, "utf8")))) {
          why.push(`${path.basename(file)} lacks ${re}`);
        }
      }
      if (c.absent && existsSync(c.absent)) why.push(`${path.basename(c.absent)} was written`);
      if (c.same) {
        const [a, b] = c.same.map((f) => (existsSync(f) ? readFileSync(f, "utf8") : undefined));
        if (a === undefined || a !== b) why.push(`${c.same.join(" and ")} differ`);
      }
      if (why.length) {
        failed++;
        process.stdout.write(`FAIL ${c.name}\n  ${why.join("\n  ")}\n${res.stdout}${res.stderr}`);
      } else process.stdout.write(`ok   ${c.name}\n`);
    }
  } finally {
    gateway.kill();
  }
  if (process.env.PROSE_SELFTEST_KEEP) process.stdout.write(`fixtures kept in ${root}\n`);
  else rmSync(root, { recursive: true, force: true });
  process.stdout.write(`${cases.length - failed}/${cases.length} passed\n`);
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------------------

const { step, opts } = parseArgs(process.argv.slice(2));
if (!step || step === "--help" || opts.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(step ? 0 : 2);
}
if (API_STEPS.includes(step)) {
  const messages = buildMessages(step, opts);
  if (step === "review" && !opts.out && opts.in) opts.out = defaultReviewOut(opts.in);
  if (messages.skip) {
    process.stdout.write(`${messages.skip}\n`);
    process.exit(0);
  }
  if (opts["dry-run"]) {
    const temperature = opts.temperature ?? TEMPERATURE[step] ?? 0.3;
    process.stdout.write(
      `== ${step} (${messages.lang}, ${messages.prof.name}) · model ${opts.model ?? DEFAULT_MODEL} · temperature ${temperature} · max_tokens ${opts["max-tokens"] ?? 32000}${opts.out ? ` · out ${opts.out}` : ""} ==\n` +
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
  else if (step === "plan") runPlan(opts);
  else if (step === "assemble") runAssemble(opts);
  else if (step === "route") runRoute(opts);
  else if (step === "selftest") await runSelftest();
  else if (step === "unstrip") runUnstrip(opts);
  else runStrip(opts);
} else {
  fail(`unknown step "${step}"; steps: ${[...API_STEPS, ...LOCAL_STEPS].join(", ")}`);
}

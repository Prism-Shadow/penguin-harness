#!/usr/bin/env node
/**
 * Prose for penguin.ooo (blog posts, docs pages, landing copy): every reader-facing word comes
 * from a model on the TokenDance gateway, and this script is the only way it gets there. API steps
 * assemble one prompt pair from ../prompts and ../reference, send it, and save the answer plus the
 * raw response; local steps check, strip and pair-check the drafts without touching the network.
 *
 *   node prose.mjs <step> [options]
 *
 *   API steps:   outline | section | write | translate | polish | fix | review
 *   local steps: plan | assemble | route | check | strip | pair | selftest
 *
 * A post is planned once (outline, then plan validates and freezes it), written one section per
 * call, assembled byte for byte, reviewed and fixed per section, and published by strip, which
 * turns the fact markers into numbered footnotes.
 *
 * Run with --help for the options. The key comes from TOKENDANCE_API_KEY or the file named by
 * TOKENDANCE_KEY_FILE, never from an argument, so it stays out of shell history; nothing here
 * prints it, and the saved raw JSON holds the request body and the response, not the headers.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const API_STEPS = ["outline", "section", "write", "translate", "polish", "fix", "review"];
const LOCAL_STEPS = ["plan", "assemble", "route", "check", "strip", "pair", "selftest"];
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

const HELP = `usage: node prose.mjs <step> [options]

The flow for a post (one language; the second follows by translate per section):
  outline → plan --freeze → section 0 … N (each: check --section) → assemble → check → review
  + truth review → route → fix per section → assemble → … → strip (citations) → check --draft

API steps (one gateway call each; --dry-run prints the messages instead and saves nothing):
  outline    --brief <f> --facts <f> --figure-count <text> [--figures <manifest>]
             [--word-budget <n|a-b>] [--section-cap <n>] [--research <f>]...
             [--feedback <text|@f> --previous <f>] [--meme <f>] [--title-rule <text|@f>]
               the answer's # Plan table is validated against the profile's budgets, the
               manifest and FACTS; a failure writes outline-feedback.auto.md beside --out
  section    --outline <outline.final.md> --section <n> --facts <f> [--figures <manifest>]
             [--sections-dir <dir>] [--out <dir>/s<n>.<lang>.v<k>.md] [--reuse-figures <frozen draft>]
             [--feedback <text|@f> [--previous <f>]] [--facts-all] [--title-rule …] [--meme <f>]
             [--version-note <t>] [--date YYYY-MM-DD]
               writes one section from the frozen plan; --out defaults to the next version
  write      --outline <f> --figures <f> --facts <f> [--meme <f>] [--title-rule <text|@f>]
               a whole piece in one call (docs pages, landing strings; posts use section)
  translate  --in <f> --facts <f> --to en|zh [--title-rule <text|@f>]
             section mode (an s<n>.<lang>.v<k>.md input, or --sections-dir): --outline <f>;
             [--reuse-figures <frozen target draft> --reuse-source <frozen source draft>]
  polish     --in <f>                       section mode: neighbours read-only
  fix        --in <f> --findings <f> --facts <f>   section mode: returns the section only
  review     --in <f> [--facts <f>] [--tells]   numbered findings in the form fix reads; --out
             defaults to findings.<lang>.vN.api.md (findings.s<n>.<lang>.vK.api.md for a section)

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
  check      --in <f> [--profile <name|f>] [--facts <f>] [--outline <f>] [--section <n>]
             [--figures <manifest>] [--svg <dir>] [--draft <f>] [--slug <slug>] [--pair <f>]
             [--assets <dir>] [--version-note <t>] [--lang en|zh]
               budgets are hard: a section above min(plan × 1.1, profile cap) is an error
               --section (or an s<n>… file): one section — its shape and the figures its row owns
               --figures: every manifest stem has a figure block, in order, and no others
               --svg: on a draft, <dir>/<id>.<lang>.html must exist for every drawn figure block
                 and match it exactly (title = alt, figcaption = caption, fig-steps = text,
                 drawn text leaves = text, ids <slug>-<id>-<lang>, no blank line)
               --draft: on a stripped post, the same assertions for its inline figures against
                 the draft's blocks; footnotes are checked against ## SOURCES with --facts
  pair       --in <f> --pair <f>   per section: markers, citations, figures, code, URLs, numbers
  strip      --in <f> --out <f> [--facts <f> [--numbering-from <other language's post>]]
             [--figures-dir <dir>] [--assets <dir>]
               removes the model's notes; with --facts each marker group becomes [^n] after its
               sentence (public sources, numbered by first use or by the other post) and the
               [^n]: [title](url) list closes the post; a drawn figure block becomes
               <dir>/<id>.<lang>.html on one line, a screenshot block an image line + caption
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
  if (!name && isFile) {
    const m = /^profile-(.+)\.md$/.exec(path.basename(o.profile));
    if (m && knownProfileName(m[1])) name = m[1];
  }
  if (!name && meta.category) name = `blog-${meta.category}`;
  if (!name && meta.description !== undefined) name = "docs";
  if (!name) {
    name = "blog-perspectives";
    if (announce) note("profile blog-perspectives (the default; pass --profile to choose)");
  }
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

/** What every step that sees the profile shares: the piece, the profile text, the contract. */
function profileParams(F, prof, lang, { contract, markers, date, versionNote } = {}) {
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
 * section step, so a budget means the same number everywhere.
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
    unitName: zh ? "Chinese characters" : "English words",
    total: rangeOf(s[zh ? "zh-chars" : "words"]),
    lead: rangeOf(s[zh ? "zh-lead-chars" : "lead-words"]),
    section: rangeOf(s[zh ? "zh-section-chars" : "section-words"]),
    sections: rangeOf(s.sections),
    tldr: s.tldr === "yes" ? rangeOf(s[zh ? "zh-tldr-chars" : "tldr-words"]) : undefined,
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

/** A row's hard limit: the smaller of the profile cap and the plan's number plus ten percent. */
function rowCap(budgets, n, planned) {
  const limit = n === 0 ? budgets.lead : budgets.section;
  const caps = [limit?.cap, planned > 0 ? Math.round(planned * 1.1) : undefined].filter(
    (x) => x !== undefined,
  );
  return caps.length ? Math.min(...caps) : undefined;
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

/** The contract and budget slots a call that returns one section needs. */
function sectionParams(
  F,
  prof,
  lang,
  n,
  { cap, planned, budgets, figureIds, markers, date, versionNote },
) {
  const params = profileParams(F, prof, lang, { contract: true, markers, date, versionNote });
  params.CONTRACT = read(path.join(PROMPTS, "contract-section.md")).trim();
  params.SECTION_N = String(n);
  params.SECTION_SHAPE = n === 0 ? F["section-shape-lead"] : F["section-shape-body"];
  params.SECTION_BUDGET =
    cap !== undefined ? `${cap} ${budgets.unitName}` : "the size the plan gives";
  params.SECTION_WORDS_PLANNED =
    planned !== undefined ? `${planned} ${budgets.unitName}` : "the size the plan gives";
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
  if (o.facts) content.FACTS = read(o.facts, "--facts").trim();
  const titleRule = o["title-rule"] !== undefined ? textOrFile(o["title-rule"]) : undefined;
  const input = o.in ? read(o.in, "--in") : undefined;
  const doc = input !== undefined ? splitFrontmatter(input) : { meta: {}, body: "" };
  const prof = resolveProfile(o, doc.meta);
  const sec = ["translate", "polish", "fix", "review"].includes(step)
    ? sectionModeOf(o)
    : undefined;
  // The plan, when one is given and counts in this language's unit, sizes a section call.
  const planRow = (n, l) => {
    if (!o.outline) return undefined;
    const outline = parseOutline(read(o.outline, "--outline"));
    return outline.unit === budgetsOf(prof, l, o).unit
      ? outline.rows.find((r) => r.n === n)
      : undefined;
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
      params = profileParams(F, prof, lang, {
        contract: true,
        markers: "write",
        date: o.date ?? today(),
        versionNote: o["version-note"],
      });
      params.STYLE = stylePrompt(lang);
      params.TITLE_RULE = titleRule ?? "";
      params.MEME_BRIEF_SECTION = meme;
      if (o.outline) content.OUTLINE = read(o.outline, "--outline").trim();
      if (o.figures) content.FIGURES = read(o.figures, "--figures").trim();
      else if (prof.kind !== "post") content.FIGURES = "(none: this text has no figures)";
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
      const planned = outline.unit === budgets.unit ? row.budget : undefined;
      const cap = rowCap(budgets, n, planned);
      params = sectionParams(F, prof, lang, n, {
        cap,
        planned,
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
      hooks.after = (out) => sectionAfter(out, { n, lang, row, budgets, cap, file: o.out });
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
          budgets,
          figureIds: figureIdsIn(input),
        });
        params.SECTION_CONTEXT = `${F["translated-context"]}\n\n`;
        params.SOURCE_LABEL = `Source section ${sec.n}`;
        content.PLAN_TABLE = outline.planTable;
        content.PREVIOUS_SECTIONS = previousSections(F, sec.dir, sec.n, lang);
        o.out ??= nextSectionFile(sec.dir, sec.n, lang);
      } else {
        params = profileParams(F, prof, lang, { contract: true, ...shared });
        params.SECTION_CONTEXT = "";
        params.SOURCE_LABEL = `Source ${NOUN[prof.kind]}`;
      }
      params.STYLE_TARGET = stylePrompt(lang);
      params.TARGET_LANG_NAME = LANG_NAME[lang];
      params.SOURCE_LANG_NAME = LANG_NAME[sourceLang];
      params.SOURCE_LANG = sourceLang;
      params.TITLE_RULE = titleRule ?? F[`title-rule-translate-${lang}`];
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
      if (sec) {
        const budgets = budgetsOf(prof, lang, o);
        const row = planRow(sec.n, lang);
        params = sectionParams(F, prof, lang, sec.n, {
          ...shared,
          cap: rowCap(budgets, sec.n, row?.budget),
          planned: row?.budget ?? countBody(input, lang),
          budgets,
          figureIds: figureIdsIn(input),
        });
        params.NEIGHBOURS = `${F.neighbours}\n\n`;
        content.NEIGHBOUR_TEXT = neighbourText(sec.dir, sec.n, lang);
        params.DRAFT_LABEL = `Section ${sec.n} (return this section only)`;
        params.DRAFT_HEADING = `## Section ${sec.n} (the one to edit; return it only)\n`;
        if (step === "fix") o.out ??= nextSectionFile(sec.dir, sec.n, lang);
      } else {
        params = profileParams(F, prof, lang, { contract: true, ...shared });
        params.NEIGHBOURS = "";
        params.DRAFT_LABEL = NOUN[prof.kind][0].toUpperCase() + NOUN[prof.kind].slice(1);
        params.DRAFT_HEADING = "";
      }
      params[step === "polish" ? "STYLE_TARGET" : "STYLE"] = stylePrompt(lang);
      if (step === "polish") Object.assign(params, tells(F, lang));
      else if (o.findings) content.FINDINGS = read(o.findings, "--findings").trim();
      content.DRAFT = sec ? fenced(input) : input.trim();
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
      if (sec) {
        params.SCOPE = F["review-scope-section"];
        params.NEIGHBOURS = `${F.neighbours}\n\n`;
        content.NEIGHBOUR_TEXT = neighbourText(sec.dir, sec.n, lang);
        params.DRAFT_LABEL = `Section ${sec.n} (the one to review)`;
      } else {
        params.SCOPE = F["review-scope-post"];
        params.NEIGHBOURS = "";
        params.DRAFT_LABEL = NOUN[prof.kind][0].toUpperCase() + NOUN[prof.kind].slice(1);
      }
      content.DRAFT = sec ? fenced(input) : input.trim();
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
function sectionAfter(out, { n, lang, row, budgets, cap, file }) {
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
  if (/\[\^/.test(out)) problems.push("a footnote `[^…]` (citations are generated, not written)");
  if (/^\*\*(Sources|来源)/m.test(out)) problems.push("a Sources line");
  const sizes = n === 0 ? leadCounts(out, lang) : { lead: countBody(out, lang) };
  const count = sizes.lead;
  process.stderr.write(
    `section ${n}: ${count} ${budgets.unit}${cap !== undefined ? ` of at most ${cap}` : ""}${row.budget > 0 ? ` (plan ${row.budget})` : ""}` +
      `${sizes.tldr !== undefined ? `; TL;DR ${sizes.tldr}${budgets.tldr ? ` of at most ${budgets.tldr.cap}` : ""}` : ""}\n`,
  );
  if (cap !== undefined && count > cap)
    problems.push(`over budget: ${count} ${budgets.unit} > ${cap}`);
  if (sizes.tldr !== undefined && !budgets.tldr)
    problems.push("a TL;DR, which this profile does not have");
  if (sizes.tldr !== undefined && budgets.tldr && sizes.tldr > budgets.tldr.cap) {
    problems.push(`TL;DR over budget: ${sizes.tldr} ${budgets.unit} > ${budgets.tldr.cap}`);
  }
  for (const p of problems) note(p);
  note(
    problems.length
      ? `rerun this section with --feedback naming the problems; never trim it by hand (${file})`
      : `next: check --in ${file} --section ${n} --outline <outline> --facts <facts> --figures <manifest>`,
  );
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

  let out = `${unwrapFence(text)}\n`;
  if (messages.transform) out = messages.transform(out);
  mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
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
  return { text, ids, urls, terms, sources, tags };
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
function svgLeaves(svg) {
  const leaves = [];
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const inner = m[1];
    for (const t of inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) leaves.push(plain(t[1]));
    const direct = plain(inner.replace(/<tspan\b[\s\S]*?<\/tspan>/g, " "));
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
  if (m && !/^(draft|outline|findings)\b/.test(m[1])) return m[1];
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
  if (prof.kind !== "landing") checkBudgets(doc, lang, prof, o, r, { section: secN });

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
    if (!data && /<\/?[a-zA-Z][^>]*>/.test(t))
      r.add("error", it.n, "raw HTML (the only HTML a post may hold is a one-line inline figure)");
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
  return { h2, used, footer };
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
  const refsOf = (d, labels) =>
    d.items.flatMap((it) =>
      ["code", "footnote"].includes(it.type)
        ? []
        : [...it.line.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => labels.get(m[1]) ?? `[^${m[1]}]`),
    );
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const da = parseText(sa[i].text, `${a.file}#s${i}`);
    const db = parseText(sb[i].text, `${b.file}#s${i}`);
    const where = i === 0 ? "the lead" : `section ${i}`;
    compare(`${where}: code spans`, codeSpans(da), codeSpans(db), "error");
    compare(`${where}: URLs`, urlsOf(da), urlsOf(db), "error");
    compare(`${where}: fact markers`, markersOf(da), markersOf(db), "error");
    compare(`${where}: cited sources`, refsOf(da, ka), refsOf(db, kb), "error");
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
  const items = read(o.findings, "--findings")
    .split(/^(?=\s*\d+\.\s)/m)
    .map((s) => s.trim())
    .filter((s) => /^\d+\.\s/.test(s));
  const sections = [...sectionFiles(dir, lang).entries()].map(([n, list]) => ({
    n,
    text: locatable(read(list[list.length - 1].file)),
  }));
  const routed = new Map();
  const unrouted = [];
  for (const item of items) {
    const quote = /^\d+\.\s*\[([\s\S]+?)\]\s*[—–-]/.exec(item)?.[1];
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
 * The citation renderer for one post: each marker group becomes `[^n]` after the sentence's
 * closing punctuation, one per distinct public source of its facts, numbered by first use (or by
 * the other language's map); opinions and private sources emit nothing.
 */
function citations(facts, numberingFrom) {
  if (!facts.sources.size) fail("the facts file has no ## SOURCES section; citations need it", 1);
  const fixed = numberingFrom ? readNumbering(numberingFrom) : null;
  const numbers = new Map();
  const order = [];
  const used = new Map();
  const problems = new Set();
  const sourcesOf = (ids) => {
    const out = [];
    for (const id of ids) {
      if (id.startsWith("O")) continue;
      if (!facts.ids.has(id)) problems.add(`{${id}} is not an id in the facts file`);
      const tags = facts.tags.get(id) ?? [];
      if (facts.ids.has(id) && !tags.length) problems.add(`{${id}} has no [S…] source tag`);
      for (const t of tags) {
        const s = facts.sources.get(t);
        if (!s) problems.add(`{${id}} names ${t}, which is not in ## SOURCES`);
        else if (s.kind === "url" || s.kind === "nolink") out.push(s);
      }
    }
    return out;
  };
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
  const refs = (group) => {
    const ns = [...new Set(sourcesOf(group.match(/[FO]\d+/g)).map(numberOf))].sort((a, b) => a - b);
    return ns.map((n) => `[^${n}]`).join("");
  };
  const render = (line) =>
    line.replace(
      /([.!?。！？)）"”’」』]+)[ \t]*((?:\{[FO]\d+\})+)|[ \t]*((?:\{[FO]\d+\})+)([.!?。！？,，;；:：]+)?/g,
      (m, punct, after, group, punctAfter) =>
        after !== undefined ? punct + refs(after) : (punctAfter ?? "") + refs(group),
    );
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
  return { render, definitions, problems };
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
  const judge = (n, count, line) => {
    const row = plan?.rows.find((x) => x.n === n);
    const limit = n === 0 ? budgets.lead : budgets.section;
    const cap = rowCap(budgets, n, row?.budget);
    const what = n === 0 ? "the lead" : `section ${n}`;
    if (cap !== undefined && count > cap) {
      r.add(
        "error",
        line,
        `${what} is ${count} ${u}; its cap is ${cap}${row ? ` (plan ${row.budget}, profile cap ${limit?.cap ?? "none"})` : ""}`,
      );
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
  if (section !== undefined) return [sized(section, doc.raw, null)];
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
  return counts;
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
      `${info.used.size ? `${info.used.size} distinct markers (F ${f}, O ${info.used.size - f})` : "no markers"}`;
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
  const doc = parseDoc(o.in);
  const lang = o.lang ?? langOf(o.in);
  const cite = o.facts ? citations(loadFacts(o.facts), o["numbering-from"]) : null;
  if (!cite && o["numbering-from"]) fail("--numbering-from needs --facts");
  if (!cite && doc.raw.match(/\{F\d+\}/)) note("no --facts: markers removed without citations");
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
    const cited = cite
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
  writeFileSync(o.out, body);
  for (const n of notes) process.stderr.write(`removed note: ${n.trim()}\n`);
  process.stderr.write(`wrote ${o.out}\n`);
}

// ---------------------------------------------------------------------------
// selftest: the local steps against built-in fixtures, each run as its own process
// ---------------------------------------------------------------------------

const FIXTURE_FACTS = `## FACTS
- F1: Archived tool output is written to a file under the Project root. [S1]
- F2: The Trace keeps a marker where the output was. [S2]
- F3: The archive format was settled in a design review. [S3]

## SOURCES
- S1: PenguinHarness docs: Agent loop · https://penguin.ooo/docs/agent-loop
- S2: packages/core/src/trace/writer.ts · https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.16/packages/core/src/trace/writer.ts
- S3: design notes (paraphrased) · private

## OPINIONS
- O1: A marker beats a gap.

## TERMS
| Term | zh |
| --- | --- |
| Trace | Trace |

## NOT-FACTS
- Do not claim the archive is compressed.
`;

const FIXTURE_DRAFT = `---
title: "Self-test post"
date: 2026-10-19
category: perspectives
excerpt: "A fixture for the script's own checks."
---

Archived output keeps its place in the Trace. {F1}

## Where files go

Files live under one root per Project. {F1}

\`\`\`figure id=demo-flow
alt: Archived tool output moving to a path under the Project root.
caption: The Trace keeps a marker where the output was.
text:
- step1: <root>/<project>/
- config2: [output archived: <path>]
\`\`\`

## What the Trace keeps

The Trace keeps a short marker. {F2} The writer’s “marker” is kept, and \`it’s\` stays in code. {F2}

\`\`\`figure id=demo-shot
alt: The Trace view showing an archived output.
caption: The marker names the file as <path> and the id as \`<id>\`.
\`\`\`

## A marker beats a gap

We would rather keep a marker than leave a gap. {O1} The format was settled early {F3}.

## What to read next

The docs describe the archive in full. {F1}{F2}
`;

const FIXTURE_DRAFT_ZH = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

规则写在 CLAUDE.md。{F1} Anthropic 也这样做（见文档）{F1}，代码 \`a。 b\` 保持原样。{O1}
`;

/** The zh post cites S2 before S1: another first-use order than the en post's. */
const FIXTURE_CITES_ZH = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

Trace 记下标记，规则写在 CLAUDE.md。{F2} Anthropic 也这样做。{F1}
`;

/** The zh post cites S1 before S2, the en post's order. */
const FIXTURE_CITES_ZH_SAME_ORDER = FIXTURE_CITES_ZH.replace(
  "{F2} Anthropic 也这样做。{F1}",
  "{F1} Anthropic 也这样做。{F2}",
);

/** Two published posts citing the same two sources, each numbered by its own first use. */
const FIXTURE_ORDER_EN = `---
title: "Order fixture"
date: 2026-10-19
category: perspectives
excerpt: "Two sources."
---

The first claim.[^1] The second claim.[^2]

## More

The first claim again.[^1]

[^1]: [One](https://example.com/one)
[^2]: [Two](https://example.com/two)
`;

const FIXTURE_ORDER_ZH = `---
title: "顺序样例"
date: 2026-10-19
category: perspectives
excerpt: "两个来源。"
---

第二条说法。[^1]第一条说法。[^2]

## 更多

第一条说法再次出现。[^2]

[^1]: [Two](https://example.com/two)
[^2]: [One](https://example.com/one)
`;

/** Labels that do not run 1, 2, … in first-use order: the site would show one number and jump to another. */
const FIXTURE_ORDER_BAD = FIXTURE_ORDER_EN.replace(
  "claim.[^1] The second claim.[^2]",
  "claim.[^2] The second claim.[^1]",
);

const FIXTURE_CITES_ZH_PARTIAL = FIXTURE_CITES_ZH.replace("CLAUDE.md。{F2} ", "CLAUDE.md。");

/** A published zh post whose reference list does not match the en one. */
const FIXTURE_PUBLISHED_ZH_OTHER = `---
title: "自检文章"
date: 2026-10-19
category: perspectives
excerpt: "脚本自检用的样例。"
---

规则写在别处。[^1]

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

function runSelftest() {
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
      name: "strip turns tagged facts into numbered footnotes after the punctuation, private sources into none",
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
        /keeps its place in the Trace\.\[\^1\]\n[\s\S]*The Trace keeps a short marker\.\[\^2\][\s\S]*The format was settled early\.\n[\s\S]*in full\.\[\^1\]\[\^2\]\n\n\[\^1\]: \[PenguinHarness docs: Agent loop\]\(https:\/\/penguin\.ooo\/docs\/agent-loop\)\n\[\^2\]: \[packages\/core\/src\/trace\/writer\.ts\]\(https:\/\/github\.com\/Prism-Shadow\/penguin-harness\/blob\/v0\.2\.16\/packages\/core\/src\/trace\/writer\.ts\)\n$/,
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
      file: [published, /The writer's "marker" is kept, and `it’s` stays in code\.\[\^2\]/],
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
        /CLAUDE\.md。\[\^1\]Anthropic 也这样做。\[\^2\]\n\n\[\^1\]: \[PenguinHarness docs/,
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
        /CLAUDE\.md。\[\^1\]Anthropic 也这样做。\[\^2\]\n\n\[\^1\]: \[packages\/core\/src\/trace\/writer\.ts\]/,
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
        /at most 66 English words of body text[\s\S]*has its own, 30–50 English words, and is counted apart/,
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
        /Sections already written[\s\S]*Files live under one root per Project\.[\s\S]*- F2: The Trace keeps a marker/,
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
      name: "landing strings with a banned word and an exclamation mark fail",
      args: ["check", "--in", at("strings.en.txt"), "--profile", "landing"],
      code: 1,
      stdout: /marketing register: unlock[\s\S]*exclamation mark/,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const res = spawnSync(process.execPath, [self, ...c.args], { encoding: "utf8" });
    const why = [];
    if (res.status !== c.code) why.push(`exit ${res.status}, expected ${c.code}`);
    if (c.stdout && !c.stdout.test(res.stdout)) why.push(`stdout lacks ${c.stdout}`);
    if (c.notStdout && c.notStdout.test(res.stdout)) why.push(`stdout has ${c.notStdout}`);
    if (c.stderr && !c.stderr.test(res.stderr)) why.push(`stderr lacks ${c.stderr}`);
    if (c.file && !(existsSync(c.file[0]) && c.file[1].test(readFileSync(c.file[0], "utf8")))) {
      why.push(`${path.basename(c.file[0])} lacks ${c.file[1]}`);
    }
    if (why.length) {
      failed++;
      process.stdout.write(`FAIL ${c.name}\n  ${why.join("\n  ")}\n${res.stdout}${res.stderr}`);
    } else process.stdout.write(`ok   ${c.name}\n`);
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
  else if (step === "selftest") runSelftest();
  else runStrip(opts);
} else {
  fail(`unknown step "${step}"; steps: ${[...API_STEPS, ...LOCAL_STEPS].join(", ")}`);
}

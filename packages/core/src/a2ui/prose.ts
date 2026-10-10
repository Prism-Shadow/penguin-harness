/**
 * STE-lite lint of the prose OUTSIDE fences — the "80% of ASD-STE100" that makes model output
 * readable: short sentences, short paragraphs, the active voice, no vague words, shallow lists.
 * Heuristic by design (no parser, no dictionary), tuned to under-fire: a rule that flags correct
 * text teaches the model to game the checker instead of writing plainly, which is why the plain
 * quantifier of each language ("some" and its Chinese counterpart) is not on the vague list and
 * the wall-of-text rule only catches a paragraph the sentence splitter could not split at all.
 *
 * Excluded from every rule: fenced blocks, inline code, tables, URLs and link targets, images,
 * HTML tags and comments, headings (not sentences) and thematic breaks. List items and
 * blockquotes are linted as text. Everything here runs in the browser as well as in Node.
 */
import { fenceLineSet, scanFences, splitLines } from "./fences.js";
import type { A2uiIssue, A2uiLang, A2uiLangOption } from "./types.js";

/** Thresholds of the prose rules; the skill quotes them. */
export const PROSE_LIMITS = {
  enSentenceWords: 25,
  zhSentenceChars: 60,
  paragraphSentences: 5,
  /** A paragraph this long with no sentence break the splitter could find. */
  wallChars: 800,
  listDepth: 2,
} as const;

/** Words the lint flags as vague: name the items or the exact action instead. */
export const A2UI_VAGUE_WORDS = {
  en: ["etc.", "and so on", "various", "appropriate", "appropriately", "stuff", "things"],
  zh: ["等等", "之类", "相关的", "进行", "某种程度上"],
} as const;

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;
const LATIN = /\p{Script=Latin}/gu;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** A run of prose lines: a paragraph, one list item (with its continuation lines) or a blockquote. */
export interface ProseParagraph {
  /** Inline-cleaned text, lines joined with one space. */
  text: string;
  /** 1-based line of the first line. */
  startLine: number;
  kind: "para" | "item" | "quote";
  /** Where each source line starts inside `text`, for mapping an offset back to a line. */
  offsets: Array<{ offset: number; line: number }>;
}

/** Strips inline Markdown that is not prose: code, link targets, URLs, tags, emphasis markers. */
export function cleanInline(text: string): string {
  return text
    .replace(/`+[^`]*`+/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/[*~]+/g, "")
    .replace(/\b_+|_+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const TABLE_ROW = /^\s*\|/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const LIST_MARKER = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** The prose of a reply as paragraphs, fences and non-prose lines left out. */
export function proseParagraphs(markdown: string): ProseParagraph[] {
  const lines = splitLines(markdown);
  const fenced = fenceLineSet(scanFences(markdown));
  const paragraphs: ProseParagraph[] = [];
  let current: ProseParagraph | null = null;
  let inComment = false;
  const flush = (): void => {
    if (current !== null && current.text.trim() !== "") paragraphs.push(current);
    current = null;
  };
  const append = (p: ProseParagraph, text: string, line: number): void => {
    if (text === "") return;
    if (p.text !== "") p.text += " ";
    p.offsets.push({ offset: p.text.length, line });
    p.text += text;
  };
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    if (fenced.has(n)) {
      flush();
      continue;
    }
    let line = lines[i] ?? "";
    if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) continue;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, "");
    const open = line.indexOf("<!--");
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    if (
      line.trim() === "" ||
      HEADING.test(line) ||
      TABLE_ROW.test(line) ||
      THEMATIC_BREAK.test(line)
    ) {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      current = { text: "", startLine: n, kind: "item", offsets: [] };
      append(current, cleanInline(item[2] ?? ""), n);
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      if (current === null || current.kind !== "quote") {
        flush();
        current = { text: "", startLine: n, kind: "quote", offsets: [] };
      }
      append(current, cleanInline(quote[1] ?? ""), n);
      continue;
    }
    if (current === null) current = { text: "", startLine: n, kind: "para", offsets: [] };
    append(current, cleanInline(line.trim()), n);
  }
  flush();
  return paragraphs;
}

/** zh when CJK characters are at least half as many as Latin letters in the prose. */
export function detectLang(markdown: string): A2uiLang {
  const text = proseParagraphs(markdown)
    .map((p) => p.text)
    .join(" ");
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return cjk > 0 && cjk * 2 >= latin ? "zh" : "en";
}

export function resolveLang(markdown: string, lang?: A2uiLangOption): A2uiLang {
  return lang !== undefined && lang !== "auto" ? lang : detectLang(markdown);
}

// English: a terminator, optional closing quote or bracket, then whitespace and a capital, a digit
// or an opening quote (or the end). This keeps `check.mjs`, `e.g.` and `v1.2` inside their
// sentence without an abbreviation list. A stray 。 in English text also ends a sentence.
const EN_BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s+(?:[A-Z0-9"“'(\[]|$)|\s*$)|[。！？]+/g;
// Chinese: the full-width terminators, and ASCII ones before a space or the end in mixed text.
const ZH_BOUNDARY = /[。！？；]+|[.!?]+(?=\s|$)/g;

export function splitSentences(
  text: string,
  lang: A2uiLang,
): Array<{ text: string; offset: number }> {
  const re = new RegExp((lang === "zh" ? ZH_BOUNDARY : EN_BOUNDARY).source, "g");
  const raw: Array<{ text: string; offset: number }> = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const end = m.index + m[0].length;
    raw.push({ text: text.slice(last, end), offset: last });
    last = end;
  }
  if (last < text.length) raw.push({ text: text.slice(last), offset: last });
  return raw
    .map((s) => {
      const lead = s.text.length - s.text.trimStart().length;
      return { text: s.text.trim(), offset: s.offset + lead };
    })
    .filter((s) => /[\p{L}\p{N}]/u.test(s.text));
}

export const countWords = (text: string): number => (text.match(WORD) ?? []).length;
export const countChars = (text: string): number => [...text.replace(/\s+/g, "")].length;

const IRREGULAR_PARTICIPLES =
  "built|done|made|given|taken|written|seen|known|shown|sent|chosen|found|held|kept|left|lost|put|read|run|set|sold|told|thought|understood|cut|hit|met|paid|said|spent|won|caught|taught|brought|bought|begun|broken|driven|eaten|forgotten|frozen|hidden|spoken|stolen|drawn|grown|thrown|torn|led|fed|lit|split|spread|shut|forbidden|withdrawn|overridden|undone|rebuilt|rewritten|proven|beaten|bitten|woven|shaken|woken|sworn|bound|wound|struck|stuck|swung|hung|sung|flung|spun|bent|lent|meant|dealt|felt|learnt";
const PASSIVE_SOURCE = `\\b(?:am|is|are|was|were|be|been|being|get|gets|got|getting)\\s+(?:(?:not|always|often|usually|also|already|still|never|then|now|only|just|automatically|first|later|rarely|sometimes|typically|currently|normally|partially|fully|easily)\\s+)?(\\w{2,}ed|${IRREGULAR_PARTICIPLES})\\b`;
/** Words the `-ed` pattern catches that are not participles, or are adjectives of feeling. */
const NOT_PARTICIPLES: ReadonlySet<string> = new Set([
  "indeed",
  "need",
  "speed",
  "seed",
  "feed",
  "bleed",
  "breed",
  "deed",
  "reed",
  "weed",
  "greed",
  "proceed",
  "exceed",
  "succeed",
  "hundred",
  "naked",
  "wicked",
  "rugged",
  "sacred",
  "shed",
  "fled",
  "tired",
  "interested",
  "excited",
  "worried",
  "bored",
  "pleased",
  "surprised",
  "satisfied",
  "disappointed",
  "scared",
  "confused",
  "embarrassed",
  "relaxed",
  "annoyed",
  "amazed",
  "delighted",
  "frustrated",
]);

/** The first passive construction in an English sentence, or undefined. */
export function passiveIn(sentence: string): string | undefined {
  const re = new RegExp(PASSIVE_SOURCE, "gi");
  for (let m = re.exec(sentence); m !== null; m = re.exec(sentence)) {
    if (!NOT_PARTICIPLES.has((m[1] ?? "").toLowerCase())) return m[0];
  }
  return undefined;
}

const EN_VAGUE: ReadonlyArray<{ word: string; re: RegExp }> = A2UI_VAGUE_WORDS.en.map((word) => ({
  word,
  re: new RegExp(
    `\\b${word.replace(/\./g, "").replace(/ /g, "\\s+")}${word.endsWith(".") ? "\\b\\.?" : "(?!\\p{L})"}`,
    "iu",
  ),
}));

function excerpt(text: string): string {
  const chars = [...text];
  return chars.length > 60 ? chars.slice(0, 60).join("") + "…" : text;
}

function lineAt(p: ProseParagraph, offset: number): number {
  let line = p.startLine;
  for (const entry of p.offsets) {
    if (entry.offset <= offset) line = entry.line;
    else break;
  }
  return line;
}

const warn = (code: string, message: string, line: number): A2uiIssue => ({
  level: "warning",
  code,
  message,
  line,
});

/** List depth from indentation, one issue per list that goes past PROSE_LIMITS.listDepth. */
function lintListDepth(markdown: string, issues: A2uiIssue[]): void {
  const lines = splitLines(markdown);
  const fenced = fenceLineSet(scanFences(markdown));
  const stack: number[] = [];
  let flagged = false;
  const top = (): number => stack[stack.length - 1] ?? -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (fenced.has(i + 1)) continue;
    if (line.trim() === "") continue;
    const m = LIST_MARKER.exec(line);
    if (!m) {
      if (/^\S/.test(line)) {
        stack.length = 0;
        flagged = false;
      }
      continue;
    }
    const indent = (m[1] ?? "").replace(/\t/g, "    ").length;
    while (stack.length > 0 && indent < top()) stack.pop();
    if (stack.length === 0 || indent > top()) stack.push(indent);
    if (stack.length > PROSE_LIMITS.listDepth && !flagged) {
      flagged = true;
      issues.push(
        warn(
          "deep_nesting",
          `A list nested ${stack.length} levels deep (line ${i + 1}); keep lists to ${PROSE_LIMITS.listDepth} levels, or split them into sections.`,
          i + 1,
        ),
      );
    }
  }
}

/** STE-lite lint of the prose outside fences. `lang: "auto"` (the default) picks zh when CJK dominates. */
export function lintProse(markdown: string, opts: { lang?: A2uiLangOption } = {}): A2uiIssue[] {
  const lang = resolveLang(markdown, opts.lang);
  const issues: A2uiIssue[] = [];
  for (const p of proseParagraphs(markdown)) {
    const sentences = splitSentences(p.text, lang);
    const chars = countChars(p.text);
    if (p.kind === "para" && chars > PROSE_LIMITS.wallChars) {
      issues.push(
        warn(
          "wall_of_text",
          `A paragraph of ${chars} characters with no sentence break the reader can rest on; split it into short sentences and paragraphs.`,
          p.startLine,
        ),
      );
    } else if (p.kind === "para" && sentences.length > PROSE_LIMITS.paragraphSentences) {
      issues.push(
        warn(
          "long_paragraph",
          `A paragraph of ${sentences.length} sentences (limit ${PROSE_LIMITS.paragraphSentences}); split it, or turn the items into a list.`,
          p.startLine,
        ),
      );
    }
    for (const s of sentences) {
      const line = lineAt(p, s.offset);
      if (lang === "en") {
        const words = countWords(s.text);
        if (words > PROSE_LIMITS.enSentenceWords) {
          issues.push(
            warn(
              "long_sentence",
              `A sentence of ${words} words (limit ${PROSE_LIMITS.enSentenceWords}): "${excerpt(s.text)}". Split it: one idea per sentence.`,
              line,
            ),
          );
        }
        const passive = passiveIn(s.text);
        if (passive !== undefined) {
          issues.push(
            warn(
              "passive_voice",
              `Passive voice ("${passive}") in: "${excerpt(s.text)}". Say who does it — use the active voice, or the imperative for an instruction.`,
              line,
            ),
          );
        }
        for (const { word, re } of EN_VAGUE) {
          if (re.test(s.text)) {
            issues.push(
              warn(
                "vague_word",
                `Vague word "${word}" in: "${excerpt(s.text)}". Name the items or the exact action instead.`,
                line,
              ),
            );
          }
        }
      } else {
        const n = countChars(s.text);
        if (n > PROSE_LIMITS.zhSentenceChars) {
          issues.push(
            warn(
              "long_sentence",
              `A sentence of ${n} characters (limit ${PROSE_LIMITS.zhSentenceChars}): "${excerpt(s.text)}". Split it at the commas into full sentences.`,
              line,
            ),
          );
        }
        for (const word of A2UI_VAGUE_WORDS.zh) {
          if (s.text.includes(word)) {
            issues.push(
              warn(
                "vague_word",
                `Vague word "${word}" in: "${excerpt(s.text)}". Name the items or the exact action instead (「进行安装」→「安装」).`,
                line,
              ),
            );
          }
        }
      }
    }
  }
  lintListDepth(markdown, issues);
  return issues;
}

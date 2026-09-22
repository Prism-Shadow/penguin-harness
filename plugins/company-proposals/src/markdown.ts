/**
 * A proposal's document form — what `penguin org proposal publish --file` sends — and the
 * way back. One Markdown file: a frontmatter block with `title` and `scope` (the files the
 * change touches, each with an optional name pattern), then the sections, `## ` headings
 * over paragraphs. Three sections are required — 改动 / 目的 / 测试, or Change / Purpose /
 * Test — and the body may not link to files: a proposal is read as "what changes and why",
 * in terms of interfaces; the paths live in the scope, the diff in the PR it links as material.
 *
 * Paragraphs are the unit a comment anchors to, so their ids have to survive a revision: a
 * paragraph whose text is unchanged keeps the id it had, a new one takes the next free
 * number. The frontmatter is read by a parser of its own — the two keys it has do not
 * justify a YAML dependency in the bundle.
 */
import type {
  ProposalParagraph,
  ProposalScopeEntry,
  ProposalSection,
} from "@prismshadow/penguin-server/api";

/** What a rejected document answers: the status and code the route sends, the message the author reads. */
export class ProposalDocumentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProposalDocumentError";
  }
}

export interface ProposalDocument {
  title: string;
  scope: ProposalScopeEntry[];
  sections: ProposalSection[];
}

/** The headings the three required sections may carry, lower-cased. */
const REQUIRED: ReadonlyArray<{ names: readonly string[]; label: string }> = [
  { names: ["改动", "change", "changes"], label: "改动 / Change" },
  { names: ["目的", "purpose"], label: "目的 / Purpose" },
  { names: ["测试", "test", "tests"], label: "测试 / Test" },
];

/** Section ids and paragraph ids reuse what an earlier revision assigned to the same heading / text. */
interface Previous {
  sections: readonly ProposalSection[];
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function unquote(raw: string): string {
  const s = raw.trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\(["\\])/g, "$1") : inner;
  }
  return s;
}

/** Splits `---\n…\n---\n` off the top; the rest is the body. Without a block, everything is body. */
function splitFrontmatter(text: string): { head: string[]; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { head: [], body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0)
    throw new ProposalDocumentError("proposal_frontmatter", "Frontmatter is not closed.");
  return { head: lines.slice(1, end), body: lines.slice(end + 1).join("\n") };
}

function parseFrontmatter(head: string[]): { title: string; scope: ProposalScopeEntry[] } {
  let title = "";
  const scope: ProposalScopeEntry[] = [];
  let inScope = false;
  for (const raw of head) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const top = /^([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (top !== null && !raw.startsWith(" ")) {
      inScope = false;
      if (top[1] === "title") title = unquote(top[2] ?? "");
      else if (top[1] === "scope") inScope = true;
      continue;
    }
    if (!inScope) continue;
    const item = /^\s*-\s*(?:file:\s*(.*))?$/.exec(raw);
    if (item !== null) {
      scope.push({ file: unquote(item[1] ?? "") });
      continue;
    }
    const field = /^\s+([a-z]+):\s*(.*)$/.exec(raw);
    if (field !== null && scope.length > 0) {
      const last = scope[scope.length - 1]!;
      if (field[1] === "file") last.file = unquote(field[2] ?? "");
      else if (field[1] === "name") last.name = unquote(field[2] ?? "");
      continue;
    }
    throw new ProposalDocumentError("proposal_frontmatter", `Unreadable scope line: ${raw.trim()}`);
  }
  return { title, scope };
}

function validateScope(scope: ProposalScopeEntry[]): void {
  for (const entry of scope) {
    const file = entry.file.trim();
    if (
      file === "" ||
      file.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(file) ||
      file.split(/[\\/]/).includes("..")
    ) {
      throw new ProposalDocumentError(
        "proposal_scope",
        `Scope file must be a relative path inside the repository: ${entry.file || "(empty)"}`,
      );
    }
    entry.file = file;
    if (entry.name !== undefined) {
      try {
        new RegExp(entry.name);
      } catch {
        throw new ProposalDocumentError(
          "proposal_scope",
          `Scope name pattern is not a regular expression: ${entry.name}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** Blocks of a section's text: a fenced code block, a list (blank lines inside it included), else lines up to a blank line. */
function paragraphsOf(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const fence = FENCE.exec(line)![1]!;
      const block = [line];
      i++;
      while (i < lines.length) {
        block.push(lines[i]!);
        if (lines[i]!.trim().startsWith(fence)) {
          i++;
          break;
        }
        i++;
      }
      out.push(block.join("\n"));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const block = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.trim() === "") {
          // A blank line ends the list unless another item (or continuation) follows it.
          const after = lines[i + 1];
          if (after !== undefined && (LIST_ITEM.test(after) || /^\s{2,}\S/.test(after))) {
            block.push(next);
            i++;
            continue;
          }
          break;
        }
        if (LIST_ITEM.test(next) || /^\s{2,}\S/.test(next)) {
          block.push(next);
          i++;
          continue;
        }
        break;
      }
      out.push(block.join("\n"));
      continue;
    }
    const block = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !FENCE.test(lines[i]!)) {
      block.push(lines[i]!);
      i++;
    }
    out.push(block.join("\n"));
  }
  return out;
}

/** `](target)` where the target is a file: a path with a directory in it, a bare file name with an extension, or `file:`. */
const LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function linksToFile(text: string): string | null {
  for (const m of text.matchAll(LINK)) {
    const target = m[1]!;
    if (target.startsWith("#")) continue;
    if (SCHEME.test(target)) {
      if (/^file:/i.test(target)) return target;
      continue;
    }
    if (target.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(target)) return target;
  }
  return null;
}

/** Splits the body into sections at `## ` headings; text before the first heading is a section with an empty heading. */
function sectionsOf(body: string): Array<{ heading: string; lines: string[] }> {
  const out: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } = { heading: "", lines: [] };
  let inFence: string | null = null;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const fence = FENCE.exec(line);
    if (fence !== null) {
      if (inFence === null) inFence = fence[1]!;
      else if (line.trim().startsWith(inFence)) inFence = null;
      current.lines.push(line);
      continue;
    }
    const heading = inFence === null ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading !== null) {
      out.push(current);
      current = { heading: heading[1]!.trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  out.push(current);
  return out.filter((s) => s.heading !== "" || s.lines.some((l) => l.trim() !== ""));
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Parses and validates a document. `previous` is the proposal's current sections, so ids
 * carry over: a section keeps its id by heading, a paragraph by text.
 */
export function parseProposalDocument(
  text: string,
  previous: Previous = { sections: [] },
): ProposalDocument {
  const { head, body } = splitFrontmatter(text);
  const { title, scope } = parseFrontmatter(head);
  if (title.trim() === "") {
    throw new ProposalDocumentError("proposal_title", "Frontmatter needs a non-empty `title`.");
  }
  validateScope(scope);
  const fileLink = linksToFile(body);
  if (fileLink !== null) {
    throw new ProposalDocumentError(
      "proposal_body_links_files",
      `The body links to a file (${fileLink}); name the interface instead, and put the file in the scope.`,
    );
  }
  const raw = sectionsOf(body);
  for (const req of REQUIRED) {
    if (!raw.some((s) => req.names.includes(normalizeHeading(s.heading)))) {
      throw new ProposalDocumentError(
        "proposal_sections",
        `The body needs a \`## ${req.label}\` section (改动 / 目的 / 测试, or Change / Purpose / Test).`,
      );
    }
  }

  // Ids: sections by heading, paragraphs by text, each previous id handed out at most once.
  const prevSectionIds = new Map<string, string[]>();
  const prevParagraphIds = new Map<string, string[]>();
  let sectionMax = 0;
  let paragraphMax = 0;
  for (const s of previous.sections) {
    prevSectionIds.set(normalizeHeading(s.heading), [
      ...(prevSectionIds.get(normalizeHeading(s.heading)) ?? []),
      s.id,
    ]);
    sectionMax = Math.max(sectionMax, idNumber(s.id, "s"));
    for (const p of s.paragraphs) {
      prevParagraphIds.set(p.text, [...(prevParagraphIds.get(p.text) ?? []), p.id]);
      paragraphMax = Math.max(paragraphMax, idNumber(p.id, "p"));
    }
  }
  const take = (map: Map<string, string[]>, key: string): string | undefined =>
    map.get(key)?.shift();

  const sections: ProposalSection[] = raw.map((s) => {
    const id = take(prevSectionIds, normalizeHeading(s.heading)) ?? `s${++sectionMax}`;
    const paragraphs: ProposalParagraph[] = paragraphsOf(s.lines).map((text) => ({
      id: take(prevParagraphIds, text) ?? `p${++paragraphMax}`,
      text,
    }));
    return { id, heading: s.heading, paragraphs };
  });
  return { title: title.trim(), scope, sections };
}

function idNumber(id: string, prefix: string): number {
  const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The document again, from the record: what an implementation session is handed. */
export function renderProposalDocument(doc: ProposalDocument): string {
  const head = ["---", `title: ${quote(doc.title)}`];
  if (doc.scope.length > 0) {
    head.push("scope:");
    for (const entry of doc.scope) {
      head.push(`  - file: ${entry.file}`);
      if (entry.name !== undefined) head.push(`    name: ${quote(entry.name)}`);
    }
  }
  head.push("---");
  const body = doc.sections.map((s) => {
    const paragraphs = s.paragraphs.map((p) => p.text).join("\n\n");
    return s.heading === "" ? paragraphs : `## ${s.heading}\n\n${paragraphs}`;
  });
  return `${head.join("\n")}\n\n${body.join("\n\n")}\n`;
}

/**
 * A proposal's document form — what `penguin org proposal publish --file` sends — and the
 * way back. One Markdown file: a frontmatter block with `title`, an optional `root` (the
 * repository's directory in the shared workspace) and `scope` (the files the change touches:
 * each with its kind — edit, new, delete, or rename `from` an old path — and an optional name
 * pattern; an entry written without a kind is an edit), then the sections, `## ` headings
 * over paragraphs. Three sections are required — 改动 / 目的 / 测试, or Change / Purpose /
 * Test — and the body may not link to files: a proposal is read as "what changes and why",
 * in terms of interfaces; the paths live in the scope, the diff in the PR it links as material.
 *
 * Paragraphs are the unit a comment anchors to, so their ids have to survive a revision: a
 * paragraph whose text is unchanged keeps the id it had, a new one takes the next free
 * number. The frontmatter is read by a parser of its own — the few keys it has do not
 * justify a YAML dependency in the bundle.
 */
import type {
  ProposalParagraph,
  ProposalScopeEntry,
  ProposalScopeKind,
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
  /** The repository's directory relative to the shared workspace ("" = the workspace itself). */
  root: string;
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

/** A scope entry as written: `kind` may be left out (read as `edit`, so older skill copies keep working). */
type WrittenEntry = { kind?: string; file: string; from?: string; name?: string };

const SCOPE_KINDS: readonly ProposalScopeKind[] = ["edit", "new", "delete", "rename"];

function parseFrontmatter(head: string[]): {
  title: string;
  root: string;
  scope: WrittenEntry[];
} {
  let title = "";
  let root = "";
  const scope: WrittenEntry[] = [];
  let inScope = false;
  for (const raw of head) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const top = /^([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (top !== null && !raw.startsWith(" ")) {
      inScope = false;
      if (top[1] === "title") title = unquote(top[2] ?? "");
      else if (top[1] === "root") root = unquote(top[2] ?? "");
      else if (top[1] === "scope") inScope = true;
      continue;
    }
    if (!inScope) continue;
    // An item opens with `- <field>: <value>` (any of the entry's fields) or a bare `-`.
    const item = /^\s*-\s*(?:([a-z]+):\s*(.*))?$/.exec(raw);
    if (item !== null) {
      scope.push({ file: "" });
      if (item[1] !== undefined) setField(scope[scope.length - 1]!, item[1], item[2] ?? "", raw);
      continue;
    }
    const field = /^\s+([a-z]+):\s*(.*)$/.exec(raw);
    if (field !== null && scope.length > 0) {
      setField(scope[scope.length - 1]!, field[1]!, field[2] ?? "", raw);
      continue;
    }
    throw new ProposalDocumentError("proposal_frontmatter", `Unreadable scope line: ${raw.trim()}`);
  }
  return { title, root, scope };
}

function setField(entry: WrittenEntry, key: string, raw: string, line: string): void {
  const value = unquote(raw);
  if (key === "file") entry.file = value;
  else if (key === "kind") entry.kind = value;
  else if (key === "from") entry.from = value;
  else if (key === "name") entry.name = value;
  else
    throw new ProposalDocumentError(
      "proposal_frontmatter",
      `Unknown scope field \`${key}\` (file, kind, from, name): ${line.trim()}`,
    );
}

/** A relative path inside the repository, with forward slashes; null when it is not one. */
function relativePath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (p === "" || p.startsWith("/") || /^[A-Za-z]:\//.test(p) || p.split("/").includes("..")) {
    return null;
  }
  return p;
}

/** The frontmatter's `root`: "" (the shared workspace itself) or a relative directory. */
function validateRoot(raw: string): string {
  if (raw.trim() === "" || raw.trim() === ".") return "";
  const root = relativePath(raw);
  if (root === null) {
    throw new ProposalDocumentError(
      "scope_invalid",
      `\`root\` must be a directory relative to the shared workspace, without \`..\`: ${raw}`,
    );
  }
  return root;
}

function validateScope(written: WrittenEntry[]): ProposalScopeEntry[] {
  const seen = new Set<string>();
  return written.map((entry) => {
    const kind = (entry.kind ?? "edit").trim().toLowerCase() as ProposalScopeKind;
    if (!SCOPE_KINDS.includes(kind)) {
      throw new ProposalDocumentError(
        "scope_invalid",
        `Scope kind must be edit, new, delete or rename: ${entry.kind} (${entry.file})`,
      );
    }
    const file = relativePath(entry.file);
    if (file === null) {
      throw new ProposalDocumentError(
        "proposal_scope",
        `Scope file must be a relative path inside the repository: ${entry.file || "(empty)"}`,
      );
    }
    if (seen.has(file)) {
      throw new ProposalDocumentError("scope_invalid", `The scope lists ${file} twice.`);
    }
    seen.add(file);
    const out: ProposalScopeEntry = { kind, file };
    if (kind === "rename") {
      const from = entry.from === undefined ? null : relativePath(entry.from);
      if (from === null) {
        throw new ProposalDocumentError(
          "scope_invalid",
          `A rename needs \`from:\` — the old path, relative to root: ${file}`,
        );
      }
      out.from = from;
    } else if (entry.from !== undefined) {
      throw new ProposalDocumentError(
        "scope_invalid",
        `\`from:\` belongs to a rename only (${kind} ${file}).`,
      );
    }
    if (entry.name !== undefined) out.name = entry.name;
    if (out.name !== undefined) {
      try {
        new RegExp(out.name);
      } catch {
        throw new ProposalDocumentError(
          "proposal_scope",
          `Scope name pattern is not a regular expression: ${out.name}`,
        );
      }
    }
    return out;
  });
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
  const written = parseFrontmatter(head);
  const title = written.title;
  if (title.trim() === "") {
    throw new ProposalDocumentError("proposal_title", "Frontmatter needs a non-empty `title`.");
  }
  const root = validateRoot(written.root);
  const scope = validateScope(written.scope);
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
  return { title: title.trim(), root, scope, sections };
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
  if (doc.root !== "") head.push(`root: ${doc.root}`);
  if (doc.scope.length > 0) {
    head.push("scope:");
    for (const entry of doc.scope) {
      head.push(`  - kind: ${entry.kind}`);
      if (entry.from !== undefined) head.push(`    from: ${entry.from}`);
      head.push(`    file: ${entry.file}`);
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

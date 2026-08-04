/**
 * Pure helpers behind the Memory page.
 *
 * The shared index (`memory/AGENTS.md`) is prose the model wrote, so the edits this module
 * makes to it are pinned to the exact Markdown link form `](<workspaceKey>/<file>)`: a mention
 * of the file name in ordinary text, or an entry belonging to another Workspace, survives a
 * rename or a delete untouched.
 */
import type { MemoryWorkspaceInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/** Topic file names, matching the server's rule (a Markdown file, no path, no leading dot). */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

/** Topic types a file may declare (mirrors core's MEMORY_TOPIC_TYPES; `user` is deliberately not one). */
export const TOPIC_TYPES = ["feedback", "project", "reference"] as const;

/** Frontmatter skeleton for a new topic file, so a hand-created file starts out listable. */
export function newFileTemplate(fileName: string): string {
  const title = fileName.replace(/\.md$/, "").replace(/[_-]+/g, " ");
  const today = new Date().toISOString().slice(0, 10);
  return `---\nname: ${title}\ndescription: \ntype: project\nupdated_at: ${today}\n---\n\n`;
}

/**
 * Checks a topic file's frontmatter before it is saved, so the file stays listable — a file
 * whose `name` or `type` is missing shows up in the tree as a bare file name with no type, and
 * is that much harder for the model to judge from the index. Returns the problem to show next
 * to the editor, or undefined when the frontmatter is complete. The shared index is exempt:
 * it is not a topic file and carries no frontmatter.
 */
export function frontmatterProblem(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^﻿/, ""));
  if (!match) return S.memory.frontmatterMissing;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  if (!fields.get("name")) return S.memory.frontmatterNameRequired;
  const type = fields.get("type");
  if (!type || !(TOPIC_TYPES as readonly string[]).includes(type)) {
    return S.memory.frontmatterTypeInvalid;
  }
  return undefined;
}

/** Index links to one topic file are exactly `](<workspaceKey>/<file>)`; used to keep the index in step with a rename or delete. */
function indexLink(workspaceKey: string, fileName: string): string {
  return `](${workspaceKey}/${fileName})`;
}

/** Drops every index line pointing at a deleted topic file. */
export function indexWithoutFile(index: string, workspaceKey: string, fileName: string): string {
  const link = indexLink(workspaceKey, fileName);
  return index
    .split("\n")
    .filter((line) => !line.includes(link))
    .join("\n");
}

/** Repoints every index link from an old topic file name to its new one. */
export function indexWithRenamedFile(
  index: string,
  workspaceKey: string,
  fileName: string,
  nextName: string,
): string {
  return index.split(indexLink(workspaceKey, fileName)).join(indexLink(workspaceKey, nextName));
}

/** Offset of a Workspace's group heading in the index, so opening the index lands on the right group; -1 when the index has no heading for it yet. */
export function headingOffset(index: string, workspaceKey: string): number {
  const match = new RegExp(`^#{1,6}\\s+${workspaceKey}\\s*$`, "m").exec(index);
  return match ? match.index : -1;
}

/**
 * Tree label for a Workspace: the recorded path's last segment reads as the project the
 * Workspace is, where the key it hashes to does not. Directories written before the
 * `.workspace` marker existed, or created by hand, have no path and fall back to the key.
 */
export function workspaceLabel(w: MemoryWorkspaceInfo): string {
  if (!w.workspacePath) return w.workspaceKey;
  const segments = w.workspacePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? w.workspacePath;
}

/**
 * The topic-file name rule, extracted beside the agent service: any Markdown file that is not
 * a dotfile, carries no path separator, and is not the memory index under any casing (macOS
 * and Windows resolve `memory.md` to `MEMORY.md`). The model writes these files with the
 * ordinary file tools, so non-ASCII names are as legitimate as kebab-case ones.
 */
import { MEMORY_INDEX_FILENAME } from "@prismshadow/penguin-core";

function isPlainName(name: string): boolean {
  return name.length > 0 && !name.startsWith(".") && !/[/\\]/.test(name);
}

export function isTopicFileName(name: string): boolean {
  return (
    isPlainName(name) &&
    name.toLowerCase().endsWith(".md") &&
    name.toLowerCase() !== MEMORY_INDEX_FILENAME.toLowerCase()
  );
}

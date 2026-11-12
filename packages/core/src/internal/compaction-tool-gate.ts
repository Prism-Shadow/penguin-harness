/**
 * What a compaction's tool rounds may run (see ContextEngineDeps.compactionToolGate). A round
 * writes hand-off files for the next context, so `read_file` reads what the sandbox allows and
 * `write_file` / `edit_file` write only under this Session's scratchpad (it lives as long as the
 * Session and a fork copies it); nothing may change the Workspace. The check is on the path the
 * model wrote: absolute (a relative one resolves against the Workspace) and under the scratchpad
 * once `..` is resolved. The sandbox still applies to whatever passes.
 */
import path from "node:path";
import type { AmspRecord, ToolCallPayload } from "@prismshadow/amsp/records";
import type { CompactionToolGate, CompactionToolVerdict } from "../engine/context-engine.js";
import { EDIT_FILE_NAME } from "../environment/tools/edit-file.js";
import { READ_FILE_NAME } from "../environment/tools/read-file.js";
import { WRITE_FILE_NAME } from "../environment/tools/write-file.js";

/** The reason every refused call reads in its `[tool error]` output. */
export const COMPACTION_TOOL_REFUSAL =
  "only read_file, and write_file/edit_file inside this Session's scratchpad, are available while compacting";

const REFUSED: CompactionToolVerdict = { allow: false, reason: COMPACTION_TOOL_REFUSAL };
const ALLOWED: CompactionToolVerdict = { allow: true };

/** The call's `file_path` argument, or undefined when the arguments carry none. */
function filePathOf(toolCall: AmspRecord<ToolCallPayload>): string | undefined {
  try {
    const args: unknown = JSON.parse(toolCall.payload.arguments || "{}");
    if (args === null || typeof args !== "object") return undefined;
    const value = (args as Record<string, unknown>)["file_path"];
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `target` is `dir` or lies under it, for the platform's path rules: Windows compares
 * case-insensitively and accepts either separator, POSIX compares exactly.
 */
function isInside(dir: string, target: string, platform: NodeJS.Platform): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const norm = (value: string): string => {
    const resolved = p.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const relative = p.relative(norm(dir), norm(target));
  if (relative === "" || p.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${p.sep}`);
}

/** The gate for one Session's scratchpad. */
export function compactionToolGate(
  scratchpadDir: string,
  platform: NodeJS.Platform = process.platform,
): CompactionToolGate {
  const absolute = platform === "win32" ? path.win32.isAbsolute : path.posix.isAbsolute;
  return (toolCall) => {
    const name = toolCall.payload.name;
    if (name === READ_FILE_NAME) return ALLOWED;
    if (name !== WRITE_FILE_NAME && name !== EDIT_FILE_NAME) return REFUSED;
    const filePath = filePathOf(toolCall);
    if (filePath === undefined || !absolute(filePath)) return REFUSED;
    return isInside(scratchpadDir, filePath, platform) ? ALLOWED : REFUSED;
  };
}

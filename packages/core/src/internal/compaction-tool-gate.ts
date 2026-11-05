/**
 * What a compaction's tool rounds may run, as the Agent composes it for a Session's engine (see
 * ContextEngineDeps.compactionToolGate): the engine knows no tool by name, so the rule lives
 * here, beside the composition that hands it over.
 *
 * A round exists to write hand-off files for the next context, so it may read anything the
 * sandbox lets `read_file` read, and write only inside this Session's scratchpad — the
 * directory that lives as long as the Session, is copied by a fork, and is writable under
 * `workspace-write`. Commands and every other tool are refused: a compaction runs at the edge of
 * the context with no user watching the transcript, and nothing it does may change the Workspace.
 *
 * The check is on the path the model wrote, before the sandbox is consulted: `file_path` must be
 * absolute — a relative one resolves against the Workspace, which is exactly what is ruled out —
 * and must name a file under the scratchpad once `..` segments are resolved. The sandbox still
 * applies to whatever the gate lets through (a `read-only` Session cannot write the scratchpad,
 * and the write fails there with the sandbox's error).
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

/**
 * The gate for one Session: `read_file` is allowed, `write_file` / `edit_file` only on an
 * absolute `file_path` inside `scratchpadDir`, everything else refused.
 */
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

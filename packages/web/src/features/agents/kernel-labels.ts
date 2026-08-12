/**
 * Display names for kernel merge leaves (the dotted config paths a kernel update reports in
 * `advanced` / `kept`): fixed paths map through the dictionary, `tools.builtin.<name>`
 * renders per tool, and unknown paths (a future default the dictionary does not know yet)
 * fall back to the raw path — never hidden, never crashing.
 */
import { S } from "../../lib/strings";

const TOOL_PATH_PREFIX = "tools.builtin.";

export function kernelFieldLabel(path: string): string {
  const fixed = S.agent.kernelFields[path];
  if (fixed !== undefined) return fixed;
  if (path.startsWith(TOOL_PATH_PREFIX) && path.length > TOOL_PATH_PREFIX.length) {
    return S.agent.kernelFieldTool(path.slice(TOOL_PATH_PREFIX.length));
  }
  return path;
}

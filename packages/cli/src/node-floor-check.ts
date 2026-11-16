/**
 * The CLI entries' refusal of a Node below the floor. `engines` is advice: an npm-installed
 * CLI runs on whatever Node the machine has, so both entries (`penguin`, `penguin-hmr`) name
 * the runtime and stop before any command runs (see core's node-floor.ts).
 */
import { nodeFloorRefusal } from "@prismshadow/penguin-core";

export function exitBelowNodeFloor(): void {
  const refusal = nodeFloorRefusal();
  if (refusal === null) return;
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}

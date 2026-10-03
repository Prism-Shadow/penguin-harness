/**
 * The watchers of an Agent's `workflows/` folder (./service.ts): which events are edits of a
 * workflow, and the wait for the folder itself to appear.
 */
import fs from "node:fs";
import path from "node:path";
import { isTempName, isWorkflowId, STATE_FILE } from "./store.js";

/**
 * Watches `declared` recursively; `onEdit` hears the id of each workflow a file event names.
 * Null when it cannot be watched.
 */
export function watchFolder(declared: string, onEdit: (id: string) => void): fs.FSWatcher | null {
  // Watch the REAL path: libuv compares each event's filename against the string it was
  // given, and a Windows short name (`RUNNER~1\…`, which is what os.tmpdir() hands back
  // on a CI runner) never matches the long name the events carry — the mismatch trips an
  // assertion inside fs-event.c and aborts the whole process, which no `try` can catch.
  let dir: string;
  try {
    dir = fs.realpathSync.native(declared);
  } catch {
    dir = declared;
  }
  try {
    return fs.watch(dir, { recursive: true }, (_event, filename) => {
      const segments = typeof filename === "string" ? filename.split(/[\\/]/) : [];
      const id = segments[0];
      // The workflow's own document is not code, and neither is the staging file a write
      // of it goes through: `state.json` used to be the only name skipped, so every
      // `setState` recompiled the workflow and tore down the tree that had just written it.
      if (id === undefined || !isWorkflowId(id)) return;
      if (filename?.endsWith(STATE_FILE) || (filename !== null && isTempName(filename))) return;
      // The server's own emit (`.build/`), and any other dot-directory, is not an edit.
      if (segments[1]?.startsWith(".")) return;
      onEdit(id);
    });
  } catch {
    return null;
  }
}

/**
 * An Agent with no `workflows/` folder yet: watch its own directory for that folder to
 * appear, then stop and call `onAppear`. The Agent makes its first workflow with its file tools
 * and nothing else — without this, nothing noticed until somebody listed the workflows again,
 * and the Agent sat waiting for a load that was never going to happen.
 */
export function watchForFolder(declared: string, onAppear: () => void): fs.FSWatcher | null {
  try {
    const watcher = fs.watch(fs.realpathSync.native(path.dirname(declared)), (_event, filename) => {
      if (filename !== path.basename(declared) || !fs.existsSync(declared)) return;
      watcher.close();
      onAppear();
    });
    return watcher;
  } catch {
    return null;
  }
}

// Where the live suites keep the Git they run: the repository's own cache, beside the other
// fetched artefacts (node_modules/.cache), so a second run and a second checkout's copy reuse it.
import { fileURLToPath } from "node:url";

export const GIT_CACHE = fileURLToPath(
  new URL("../../../node_modules/.cache/agent-state-git", import.meta.url),
);

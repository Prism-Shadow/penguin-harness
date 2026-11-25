/**
 * Route groups that judge their callers' origin themselves: a group contributed with
 * `origin: "own"` (HttpModule.routes) serves callers that are cross-origin by design — the
 * PenguinHarness Browser extension pairing from its `chrome-extension://` origin — and admits or
 * refuses their origin in its own handler, so the same-origin rule for writes
 * (auth/middleware.ts, sameOriginWrites) is not applied to what it answers.
 *
 * The platform's exemption is exact, and it is not this file: HttpModule mounts these groups
 * ahead of the same-origin check (http/app.ts), so a request one of them answers never meets
 * it, while anything else under their prefixes — another method, a path the group does not
 * serve — goes on to the check like every other write.
 *
 * What this file answers is the runtime's question (`Http.ownOrigin`): its own copy of the
 * check runs in front of the seam (app.ts), where no group has been asked yet, and must not
 * refuse a write the platform would take. So it is coarse on purpose — any own-origin group's
 * prefix covering the path (http/route-prefix.ts) lets the write through to the platform, whose
 * check then decides.
 */
import { coversPath } from "./route-prefix.js";

/** Whether a write to the path may reach a group that judges its callers' origin itself. */
import type { OwnOrigin } from "@prismshadow/penguin-library-auth/middleware";

export type { OwnOrigin };

export interface OriginDeclaration {
  prefix: string;
  origin?: "own";
}

export function ownOriginPrefixes(groups: readonly OriginDeclaration[]): OwnOrigin {
  const own = groups.filter((g) => g.origin === "own").map((g) => g.prefix);
  if (own.length === 0) return () => false;
  return (path) => own.some((prefix) => coversPath(prefix, path));
}

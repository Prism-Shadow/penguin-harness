/**
 * Which writes judge their callers' origin themselves, as the route groups declare it: a group
 * contributed with `origin: "own"` (HttpModule.routes) serves callers that are cross-origin by
 * design — the PenguinHarness Browser extension pairing from its `chrome-extension://` origin —
 * and admits or refuses their origin in its own handler, so the same-origin rule for writes
 * (auth/middleware.ts, sameOriginWrites) is not applied to it.
 *
 * A path belongs to the most specific group whose prefix covers it (http/route-prefix.ts), so a
 * group mounted below an own-origin prefix is still held to the rule unless it declares the same.
 * Groups sharing that most specific prefix must all declare it: the rule fails closed.
 */
import { mostSpecific } from "./route-prefix.js";

/** Whether the route group serving a path judges its callers' origin itself. */
export type OwnOrigin = (path: string) => boolean;

export interface OriginDeclaration {
  prefix: string;
  origin?: "own";
}

export function ownOriginRule(groups: readonly OriginDeclaration[]): OwnOrigin {
  if (!groups.some((g) => g.origin === "own")) return () => false;
  return (path) => {
    const owners = mostSpecific(groups, path);
    return owners.length > 0 && owners.every((g) => g.origin === "own");
  };
}

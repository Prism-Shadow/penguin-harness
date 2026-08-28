/**
 * What this harness offers an extension BEYOND the contract — the
 * `@prismshadow/penguin-server/extension` subpath.
 *
 * The contract is `@prismshadow/penguin-core/extension` and is CLOSED: this module does not
 * reopen it by declaration merging. Augmenting it would put `terminals` into the contract
 * itself, so an extension type-checking against core would compile against a member only
 * THIS embedder supplies, with nothing at the core layer able to say so.
 *
 * What the harness offers beyond the contract is named here instead, on an interface that
 * EXTENDS it. Values of that type still satisfy the contract, so the seam is unchanged;
 * what changes is that an extension wanting `terminals` writes the cast itself
 * (`ctx as HarnessContext`) and thereby states, at the point of use, that it depends on
 * running inside this harness rather than on any embedder.
 *
 * Nor does this module re-export the contract. An extension imports the contract from core
 * and this subpath only for what its name promises, so a package's import sites say which
 * of the two it actually needs: a sandbox backend, written against the sandbox vocabulary
 * and nothing else, names core alone and does not depend on this package at all.
 */
import type { PenguinContext } from "@prismshadow/penguin-core/extension";
import type { TerminalManager } from "../terminal/manager.js";

/**
 * The instance view this harness actually hands to `"create"` handlers: the contract plus
 * the members only it owns. An extension reaching `terminals` casts to this deliberately.
 */
export interface HarnessContext extends PenguinContext {
  terminals: TerminalManager;
}

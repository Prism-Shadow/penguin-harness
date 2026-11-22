/**
 * What installing a library plugin on an Agent does about the plugin's server module on the
 * Agent's server (PRFC-0031): one pure decision over the facts the plugin-modules service reads.
 *
 * - Already listed for this Project: nothing to do.
 * - The administrator stopped it: nothing, unless the administrator asks for it explicitly.
 * - Built in (the build ships it and it only adds modules), or the actor is the administrator:
 *   listed for this Project; re-assembled only when no Project lists it yet (the tree would be
 *   the same otherwise).
 * - Running already: nothing — only the administrator puts a package on the server, and that
 *   install listed and loaded it, which was the approval.
 * - Otherwise a request for the administrator, except when no person is behind the call.
 */

/** `list` writes the table only; `load` writes it inside a re-assembly; `request` records an ask; `blocked` reports the administrator's stop. */
export type ModuleStep = "none" | "list" | "load" | "request" | "blocked";

export interface ModuleFacts {
  /** This Project lists the package for this server. */
  listed: boolean;
  /** Some Project lists it for this server (it is in the process's closure). */
  inClosure: boolean;
  /** The process loaded it. */
  running: boolean;
  builtin: boolean;
  /** An administrator's standing "no" for this package on this server. */
  declined: boolean;
  /** The actor is the administrator. */
  admin: boolean;
  /** Someone pressed the button, rather than an install asking on its way. */
  explicit: boolean;
  /** No person is behind the call (a reconcile pass). */
  system: boolean;
}

export function moduleStep(f: ModuleFacts): ModuleStep {
  if (f.listed) return "none";
  if (f.declined && !(f.admin && f.explicit)) return "blocked";
  if (f.builtin || f.admin) return f.inClosure ? "list" : "load";
  if (f.running) return "none";
  return f.system ? "none" : "request";
}

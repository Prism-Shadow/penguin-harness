/**
 * Which machine a terminal lives on.
 *
 * A terminal is a pty process on one machine's kernel: it is created there, its bytes come
 * from there, and killing it means killing it there. So every call about one has to reach
 * THAT machine — the same problem Sessions have, answered the same way (lib/session-machines.ts):
 * a rule over the PATH, so the call sites stay unchanged and the mapping is recorded in one
 * place, when a list hands a terminal back or when one is created.
 *
 * Absence means this machine, which is also every terminal that existed before terminals
 * could live anywhere else. In memory on purpose: it is rebuilt by the very list that
 * displays them, and a stale entry surviving a reload would address a pty on a machine that
 * may no longer hold — or no longer have — it.
 */
import { apiUrl } from "./server-context";

/** terminalId → the machine it lives on. Absent = this server. */
const owners = new Map<string, string>();

/** The machines whose terminals belong in the list, published by SessionsProvider. */
let machineIds: readonly string[] = [];
/**
 * Whether that publication has happened at all. Before it, an empty `machineIds` means
 * "not asked yet", not "no machines" — and the two must not be confused by anything that
 * treats the list as the whole truth. A fresh page sits in that state for as long as it
 * takes to reach the machines (a forward does not survive a reload), which is exactly
 * when a Project's terminals are all elsewhere.
 */
let published = false;

/** Records where a terminal lives. `null` (this machine) is stored as absence, not a value. */
export function rememberTerminalMachine(terminalId: string, machineId: string | null): void {
  if (machineId === null) owners.delete(terminalId);
  else owners.set(terminalId, machineId);
}

/** The machine a terminal lives on, or null for this one. */
export function machineForTerminal(terminalId: string): string | null {
  return owners.get(terminalId) ?? null;
}

/** Forgets everything — for a sign-out, where the whole list is about to be rebuilt. */
export function forgetTerminalMachines(): void {
  owners.clear();
  machineIds = [];
  published = false;
}

/**
 * The machines the terminal list should ask, besides this one. Kept here rather than read
 * from the Sessions store because the list refreshes from a module-scope timer and the
 * Ctrl+` hotkey creates shells from a module-scope listener — neither has React context.
 */
export function setTerminalMachines(ids: readonly string[]): void {
  machineIds = [...ids];
  published = true;
}

/**
 * Whether the machine set is known yet. A caller that would DISCARD something on the
 * strength of a terminal's absence has to wait for this; one that merely displays what it
 * can does not.
 */
export function terminalMachinesPublished(): boolean {
  return published;
}

/** Every source the terminal list asks: this server first, then each machine. */
export function terminalSources(): (string | null)[] {
  return [null, ...machineIds];
}

/**
 * The terminal id a path is about, or null when it is not terminal-scoped.
 *
 * Deliberately narrow, exactly as the Session rule is: only `/api/terminals/<id>` and paths
 * beneath it. The bare `/api/terminals` collection is NOT — it asks a server which terminals
 * IT has, and answering that from another machine would be that machine answering a question
 * about this one.
 */
export function terminalIdInPath(path: string): string | null {
  const match = /^\/api\/terminals\/([^/?#]+)/.exec(path);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!; // A malformed escape is not a reason to lose the id.
  }
}

/**
 * A terminal path, addressed to the machine that holds it. `server` overrides the rule, for
 * the one call that cannot use it: creating a terminal names a machine before any id exists.
 */
export function terminalUrl(path: string, server?: string | null): string {
  if (server !== undefined) return apiUrl(path, server);
  const id = terminalIdInPath(path);
  return apiUrl(path, id === null ? null : machineForTerminal(id));
}

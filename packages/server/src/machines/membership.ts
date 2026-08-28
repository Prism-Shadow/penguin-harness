/**
 * Which machines a Project uses — `<data root>/<project>/machines.json`.
 *
 * The Machines page sits in the same nav group as Agents, Skills and Models, under the
 * Project switcher, so a machine is a Project's machine: switching Projects switches the set,
 * and this Project's Model credentials go to this Project's machines and nowhere else.
 *
 * WHAT IS NOT HERE, and must not move here. This file is a MEMBERSHIP list — addresses,
 * nothing else. What is true of a machine regardless of who is asking stays in the shared
 * record beside it (installs.ts): its identity, and the version installed on it. One machine
 * runs one program, and two Projects asking about the same host must not be able to disagree
 * about what is on it — nor should the second Project have to re-send 30 MB to find out.
 *
 * So membership answers "does this Project use that machine", and the shared record answers
 * "what is on it". A machine already installed but not in this Project is a real state with a
 * real answer: adopt it, which costs one line here and no ssh at all.
 *
 * Pure functions over the file's text; the service owns the I/O.
 */

/** The addresses (`ssh:<alias>`) a Project uses, in the order they were added. */
export function parseMembers(raw: string | null): string[] {
  if (raw === null || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const list = (parsed as { machines?: unknown }).machines;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of list) {
      if (typeof entry !== "string" || entry === "" || seen.has(entry)) continue;
      seen.add(entry);
      out.push(entry);
    }
    return out;
  } catch {
    // Damage reads as "no machines", never as a refusal to serve the page: the list is
    // rebuildable by adopting, and a corrupt file must not lock someone out of the surface
    // that would let them fix it.
    return [];
  }
}

/** The file's next text with one address added or removed (idempotent either way). */
export function withMember(raw: string | null, address: string, member: boolean): string {
  const current = parseMembers(raw);
  const next = member
    ? current.includes(address)
      ? current
      : [...current, address]
    : current.filter((entry) => entry !== address);
  return JSON.stringify({ machines: next }, null, 2) + "\n";
}

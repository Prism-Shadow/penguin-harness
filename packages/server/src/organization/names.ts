/**
 * What an employee is called, and how a channel message addresses one.
 *
 * An employee has an id (the Agent's: ASCII, fixed, what files and commands use) and a NAME —
 * written in its chart entry, for people: any script, spaces allowed. Both address it in a
 * channel: `@acme_dev_a` and `@小明` reach the same desk.
 *
 * A name is the organization's to give, so it is the chart's field rather than the Agent's
 * display name (which stays the fallback for an entry that has none, then the id). Names need
 * not be unique as written: two employees called the same are told apart by the system, which
 * shows — and lets people @ — each as `name (id)`. A name nobody else has stays bare.
 */
import type { OrgEmployee } from "./files.js";

/** A name as written in the chart: one line, no `@`, at most this long. */
export const EMPLOYEE_NAME_MAX = 64;

/** Why `raw` cannot be an employee's name, or null when it can. */
export function employeeNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name === "") return "name must not be empty";
  if (name.length > EMPLOYEE_NAME_MAX) return `name is at most ${EMPLOYEE_NAME_MAX} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "name must be a single line";
  if (name.includes("@")) return "name must not contain @";
  return null;
}

/**
 * The name each employee goes by in this organization, unique across it. `fallback` answers
 * for an entry without a name of its own (the Agent's display name, else the id).
 *
 * A base name is kept bare only when it is nobody else's: not another employee's name, not
 * another employee's id, not a member's user id, not `all` — each of those is something `@`
 * already means. Otherwise the id is appended as the note, and every holder of a shared name
 * gets one, so which of two 小明 keeps the bare form never depends on the order of the chart.
 */
export function employeeNames(
  employees: readonly Pick<OrgEmployee, "agentId" | "name">[],
  fallback: (agentId: string) => string,
  reserved: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const base = new Map<string, string>();
  for (const e of employees) base.set(e.agentId, e.name ?? fallback(e.agentId));
  const holders = new Map<string, number>();
  for (const name of base.values()) holders.set(name, (holders.get(name) ?? 0) + 1);
  const ids = new Set(employees.map((e) => e.agentId));
  const out = new Map<string, string>();
  for (const [agentId, name] of base) {
    const taken =
      (holders.get(name) ?? 0) > 1 ||
      name === "all" ||
      reserved.has(name) ||
      (ids.has(name) && name !== agentId);
    out.set(agentId, taken && name !== agentId ? `${name} (${agentId})` : name);
  }
  return out;
}

/** Something `@` can name in a channel, and the principal it stands for. */
export interface MentionHandle {
  handle: string;
  /** `agent:<id>`, `user:<id>` or `all`. */
  principal: string;
}

const WORD = /[A-Za-z0-9_]/;
const EXPLICIT = /^(agent|user):([A-Za-z0-9][A-Za-z0-9_.-]*)/;

/** A mention found in a text: where it is (the `@` included) and whom it names. */
export interface MentionMatch {
  start: number;
  end: number;
  principal: string;
}

/**
 * The mentions of a text, resolved against what can be named.
 *
 * A name may be in any script and may hold spaces, so a mention cannot be cut out of the text
 * by a pattern: `@小明你好` has no delimiter after the name. It is matched instead — at each
 * `@` that does not continue a word (so `a@b.c` is an address, not a mention), the LONGEST
 * handle that the text continues with wins, which is what tells `@小明明` from `@小明`. A
 * handle ending in an ASCII word character must end the word there (`@ann` is not found in
 * `@anna`); one ending in anything else needs no boundary, since such scripts have none.
 *
 * `@agent:<id>` and `@user:<id>` stay the explicit forms, resolved by `explicit`. A `@` that
 * names nothing is text.
 */
export function findMentions(
  text: string,
  handles: readonly MentionHandle[],
  explicit: (kind: "agent" | "user", id: string) => string | null,
): MentionMatch[] {
  const byLength = [...handles].sort((a, b) => b.handle.length - a.handle.length);
  const out: MentionMatch[] = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const before = at === 0 ? "" : text[at - 1]!;
    if (before === "@" || WORD.test(before)) continue;
    const rest = text.slice(at + 1);
    const tagged = EXPLICIT.exec(rest);
    if (tagged !== null) {
      const id = tagged[2]!.replace(/[.-]+$/, "");
      const principal = explicit(tagged[1] as "agent" | "user", id);
      if (principal !== null) {
        const end = at + 1 + tagged[1]!.length + 1 + id.length;
        out.push({ start: at, end, principal });
        at = end - 1;
      }
      continue;
    }
    const hit = byLength.find(({ handle }) => {
      if (handle === "" || !rest.startsWith(handle)) return false;
      const next = rest[handle.length] ?? "";
      return !(WORD.test(handle[handle.length - 1]!) && WORD.test(next));
    });
    if (hit === undefined) continue;
    const end = at + 1 + hit.handle.length;
    out.push({ start: at, end, principal: hit.principal });
    at = end - 1;
  }
  return out;
}

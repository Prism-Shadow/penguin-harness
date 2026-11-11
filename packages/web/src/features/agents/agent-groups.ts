/**
 * How the Agents page groups its list, and what this browser remembers of it.
 *
 * By author, the default: one section per `AgentSummary.author` — people's Agents, the ones an
 * agent made, company mode's — in that order, an empty one left out, each keeping the list's own
 * order. Or not at all, which is the list with the organizations' employees in a section of their
 * own (agent-employment.ts). The choice and which sections are folded are remembered per browser
 * (`penguin.agentsGroupBy`, `penguin.agentsGroupsFolded`).
 */
import type { AgentAuthor, AgentSummary } from "@prismshadow/penguin-server/api";

/** The section order of the grouping by author. */
export const AGENT_AUTHORS: readonly AgentAuthor[] = ["user", "agent", "company"];

/** Who made an Agent; a list from an older server carries no author, which reads as a person. */
export function authorOf(agent: Pick<AgentSummary, "author">): AgentAuthor {
  return agent.author ?? "user";
}

/** One section of the grouping by author. */
export interface AuthorGroup<T> {
  author: AgentAuthor;
  items: T[];
}

/** The items by author, in AGENT_AUTHORS order, each in the order given; no empty section. */
export function groupByAuthor<T>(
  items: readonly T[],
  agentOf: (item: T) => Pick<AgentSummary, "author">,
): AuthorGroup<T>[] {
  return AGENT_AUTHORS.map((author) => ({
    author,
    items: items.filter((item) => authorOf(agentOf(item)) === author),
  })).filter((group) => group.items.length > 0);
}

/** How the page groups its list. */
export const AGENT_GROUP_BYS = ["author", "none"] as const;
export type AgentGroupBy = (typeof AGENT_GROUP_BYS)[number];

export const AGENTS_GROUP_BY_KEY = "penguin.agentsGroupBy";
export const AGENTS_GROUPS_FOLDED_KEY = "penguin.agentsGroupsFolded";

/**
 * The grouping this browser last chose; by author when nothing usable is stored, or storage
 * throws (it does where site data is blocked — `localStorage` is touched inside the try).
 */
export function initialAgentsGroupBy(): AgentGroupBy {
  try {
    const stored = localStorage.getItem(AGENTS_GROUP_BY_KEY);
    return AGENT_GROUP_BYS.find((by) => by === stored) ?? "author";
  } catch {
    return "author";
  }
}

/** Remembers the grouping (best-effort: quota limits / private browsing fail silently). */
export function storeAgentsGroupBy(by: AgentGroupBy): void {
  try {
    localStorage.setItem(AGENTS_GROUP_BY_KEY, by);
  } catch {
    /* best-effort persistence */
  }
}

/** The author sections this browser folded; none when nothing usable is stored. */
export function initialFoldedAuthors(): Set<AgentAuthor> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(AGENTS_GROUPS_FOLDED_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? AGENT_AUTHORS.filter((author) => parsed.includes(author)) : [],
    );
  } catch {
    return new Set();
  }
}

/** Remembers the folded sections (best-effort, like the grouping). */
export function storeFoldedAuthors(folded: ReadonlySet<AgentAuthor>): void {
  try {
    localStorage.setItem(AGENTS_GROUPS_FOLDED_KEY, JSON.stringify([...folded]));
  } catch {
    /* best-effort persistence */
  }
}

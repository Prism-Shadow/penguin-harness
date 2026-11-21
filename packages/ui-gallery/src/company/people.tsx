/**
 * An employee where its work shows: its name, then its title in quieter ink, so a byline says who
 * did the work and what they do.
 *
 * Every employee is named after a penguin species. The lead and the verifier are every company's;
 * the other roles are the company's own, drafted by the lead from the mission and left as the
 * reader made them, so who a byline is depends on the company: the prototype provides its roles
 * (`StaffProvider`) and everything under it reads a byline through `usePerson`.
 */
import { createContext, useContext } from "react";
import { AgentAvatar } from "@prismshadow/penguin-ui";
import { AGENT_ID, WEEK_STAFF } from "./fixtures";
import type { Byline, Role, Species } from "./fixtures";
import { roleWords } from "./text";
import { useWords } from "./use-words";
import type { Words } from "./words";

/** An employee as the page shows it. */
export interface Person {
  species: Species;
  name: string;
  title: string;
  duties: string;
  /** What it watches; empty for the lead, the verifier, and a role the reader added. */
  sources: string;
}

/** Who a byline is on this team. */
export function personOf(staff: readonly Role[], byline: Byline, W: Words): Person {
  if (byline === "lead" || byline === "verifier") {
    const species = byline === "lead" ? "emperor" : "chinstrap";
    return { species, name: W.species[species], ...W.people[byline], sources: "" };
  }
  const role = staff.find((candidate) => candidate.id === byline);
  if (role === undefined) {
    return { species: "macaroni", name: byline, title: "", duties: "", sources: "" };
  }
  return { species: role.species, name: W.species[role.species], ...roleWords(role, W) };
}

const StaffContext = createContext<readonly Role[]>(WEEK_STAFF);

/** The company's roles, for every byline under it. */
export const StaffProvider = StaffContext.Provider;

/** Who a byline is, on the company's team. */
export function usePerson(): (byline: Byline) => Person {
  const W = useWords();
  const staff = useContext(StaffContext);
  return (byline) => personOf(staff, byline, W);
}

/** An employee as one line of text, for a hint or a label that takes a string. */
export function useWho(): (byline: Byline) => string {
  const W = useWords();
  const person = usePerson();
  return (byline) => W.who(person(byline).name, person(byline).title);
}

export function PersonName({ byline }: { byline: Byline }) {
  const person = usePerson()(byline);
  return (
    <span>
      <span className="text-fg">{person.name}</span>{" "}
      <span className="text-fg-muted">{person.title}</span>
    </span>
  );
}

/** A penguin's avatar, in the colour its Agent id gives it. */
export function SpeciesAvatar({ species, size }: { species: Species; size: number }) {
  return <AgentAvatar id={AGENT_ID[species]} size={size} />;
}

/** An employee's avatar. */
export function PersonAvatar({ byline, size }: { byline: Byline; size: number }) {
  return <SpeciesAvatar species={usePerson()(byline).species} size={size} />;
}

import { createContext, useContext } from "react";
import type { Lang, Place, Route } from "./frame";
import type { Org, Stage } from "./model";
import type { Words } from "./words";

export interface CompanyActions {
  decide: (ticket: string, answer: string) => void;
  accept: (ticket: string) => void;
  sendBack: (ticket: string, note: string) => void;
  resume: (ticket: string) => void;
  stop: (ticket: string) => void;
  rollBack: (member: string) => void;
}

export interface CompanyValue {
  w: Words;
  lang: Lang;
  org: Org;
  place: Place;
  go: (route: Route) => void;
  openTicket: (id: string | null) => void;
  act: CompanyActions;
}

export const CompanyContext = createContext<CompanyValue | null>(null);

export function useCompanyApp(): CompanyValue {
  const value = useContext(CompanyContext);
  if (value === null) throw new Error("useCompanyApp must be used inside the company app");
  return value;
}

export const STAGE_TONE: Record<Stage, "success" | "attention" | "danger" | "neutral"> = {
  working: "success",
  verifying: "success",
  yours: "attention",
  halted: "danger",
  done: "neutral",
};

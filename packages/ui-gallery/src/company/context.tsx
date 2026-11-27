import { createContext, useContext } from "react";
import type { Lang } from "./frame";
import type { Org } from "./model";
import type { Words } from "./words";

export interface CompanyValue {
  w: Words;
  lang: Lang;
  org: Org;
  stop: (session: string) => void;
}

export const CompanyContext = createContext<CompanyValue | null>(null);

export function useCompanyApp(): CompanyValue {
  const value = useContext(CompanyContext);
  if (value === null) throw new Error("useCompanyApp must be used inside the company app");
  return value;
}

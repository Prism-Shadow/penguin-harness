/**
 * The Action keys the caller may run on a subject now, as the server's guards answer
 * (`GET …/actions?subject=`): what a page shows a button for, without repeating the rules. Read
 * again whenever `version` changes (the subject was written), null until the first answer and
 * whenever a read fails — the page then falls back to what the status alone says.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";

export function useAllowedActions(
  projectId: string,
  orgId: string,
  subject: string,
  version: unknown,
): ReadonlySet<string> | null {
  const [allowed, setAllowed] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let alive = true;
    api.listOrgActions(projectId, orgId, subject).then(
      (res) => {
        if (alive)
          setAllowed(new Set(res.actions.filter((a) => a.allowed === true).map((a) => a.key)));
      },
      () => {
        if (alive) setAllowed(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, orgId, subject, version]);
  return allowed;
}

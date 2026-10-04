/**
 * The guards' answers on a subject for the caller now (`GET …/actions?subject=`): the Action
 * keys allowed — what a page shows a button for, without repeating the rules — and the refusal
 * of each one that is not, for the page to say why its button is disabled. Read again whenever
 * `version` changes (the subject was written), null until the first answer and whenever a read
 * fails — the page then falls back to what the status alone says.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import { actionAnswers, type ActionAnswers } from "./action-refusals";

export function useAllowedActions(
  projectId: string,
  orgId: string,
  subject: string,
  version: unknown,
): ActionAnswers | null {
  const [answers, setAnswers] = useState<ActionAnswers | null>(null);
  useEffect(() => {
    let alive = true;
    api.listOrgActions(projectId, orgId, subject).then(
      (res) => {
        if (alive) setAnswers(actionAnswers(res.actions));
      },
      () => {
        if (alive) setAnswers(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, orgId, subject, version]);
  return answers;
}

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { EmptyState, Spinner } from "@prismshadow/penguin-ui";
import {
  getSession,
  apiErrorText,
  PageIdentity,
  pageSessionId,
  focusSessionMachine,
  S,
  useProject,
} from "@prismshadow/penguin-web/internal";
import type {
  OpenPage,
} from "@prismshadow/penguin-web/internal";

/** A full-page chat reached from a machine-qualified workbench can be reloaded on that same machine. */
export function ScopedChat({ page, children }: { page: OpenPage; children: ReactNode }) {
  if (!page.id.startsWith("scoped-chat:")) return children;
  return <QualifiedSession page={page}>{children}</QualifiedSession>;
}

function QualifiedSession({ page, children }: { page: OpenPage; children: ReactNode }) {
  const project = useProject().currentProject?.projectId;
  const query = new URL(page.path, window.location.origin).searchParams;
  const targetProject = query.get("project");
  const machineId = query.get("machine") || null;
  const id = pageSessionId(page);
  const [result, setResult] = useState<OpenPage["sessionHost"]>();
  const [error, setError] = useState<string | null>(null);
  const authorized = page.sessionHost ?? result;
  useEffect(() => {
    if (authorized || !project || project !== targetProject) return;
    let current = true;
    void getSession(id, machineId)
      .then(({ session }) => {
        if (!current) return;
        if (session.projectId !== project || session.sessionId !== id) {
          setError(S.chat.sessionNotFound);
          return;
        }
        setResult({ session, machineId, isolatedDraft: true });
      })
      .catch((reason: unknown) => {
        if (current) setError(apiErrorText(reason));
      });
    return () => {
      current = false;
    };
  }, [authorized, project, targetProject, id, machineId]);
  useLayoutEffect(() => {
    if (authorized && project === targetProject) return focusSessionMachine(id, machineId);
  }, [authorized, project, targetProject, id, machineId]);
  if (error || (project && project !== targetProject))
    return <EmptyState title={error ?? S.chat.sessionNotFound} />;
  if (!authorized || !project) return <Spinner label={S.common.loading} />;
  return (
    <PageIdentity.Provider value={{ ...page, sessionHost: authorized }}>
      {children}
    </PageIdentity.Provider>
  );
}

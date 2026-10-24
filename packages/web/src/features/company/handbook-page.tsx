/**
 * The organization handbook — `handbook/` in the organization directory, the company's
 * knowledge base — is the Workspace Files panel itself, browsing that directory: the same
 * `WorkspaceBrowser` over the directory-addressed file routes, so its tree, search, toolbar, path
 * bar, preview (Markdown in the reader, with its outline and find in the path bar), editor,
 * menus, uploads and keys are the Files panel's by construction rather than lookalikes. The
 * handbook's listing route names the directory; the Files panel's routes take the same Project
 * access the handbook's do.
 *
 * What is the handbook's own is what the Files panel has no counterpart for: the index
 * (`README.md`) stays where it is — no rename, move or delete is offered on it, since every
 * trigger tells an employee to read it — and it opens on arrival; and no conversation sits beside
 * the page, so nothing offers to add a file to one. A relative link between documents opens the
 * linked document in place, as it does for any Workspace file.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, SkeletonList } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { WorkspaceBrowser } from "../workspace/workspace-browser";
import { useOrg } from "./org-layout";

/** The index, `handbook/README.md`: opened on arrival, and kept where it is. */
const HANDBOOK_INDEX = "README.md";

/** What the handbook's Files panel keeps in place. */
const PROTECTED = new Set([HANDBOOK_INDEX]);

export function HandbookPage() {
  const { projectId, orgId, org } = useOrg();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.handbook}` : S.nav.org.handbook);
  /** The handbook directory's absolute path, once the listing has named it. */
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDir((await api.listOrgHandbookFiles(projectId, orgId)).dir);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);

  // Another organization's handbook must not linger while this one loads.
  useEffect(() => {
    setDir(null);
    void load();
  }, [load]);

  // One request per directory: the panel opens the index the first time it is shown.
  const openIndex = useMemo(() => (dir === null ? null : { path: HANDBOOK_INDEX }), [dir]);

  if (dir === null) {
    return error !== null ? (
      <EmptyState
        title={S.company.handbook.loadFailed}
        description={error}
        action={
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        }
      />
    ) : (
      <div aria-busy="true">
        <SkeletonList rows={8} />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <WorkspaceBrowser
        scope={{ kind: "workspace", projectId, workspace: dir, machineId: null }}
        openRequest={openIndex}
        protectedPaths={PROTECTED}
      />
    </div>
  );
}

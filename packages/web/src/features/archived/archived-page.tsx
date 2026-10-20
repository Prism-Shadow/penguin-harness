/**
 * Archived chats (/archived): the conversations that are not in the sidebar.
 *
 * The archive list itself lives in the settings dialog (Settings › Personal › Archived
 * chats) — a page nobody thinks to open when they have just archived something by
 * accident. This page is the same list one click from the nav, so "where did that
 * conversation go?" has an answer that does not need remembering a menu path.
 *
 * Two things differ from the settings page, both about what a person is looking for here:
 * the list opens on **the chats a person archived by hand** (`source=user`), not on the
 * thousands of sessions a program opened (the Agent API, a scheduled task, the CLI), which
 * are behind the source filter; and the page scrolls as a page rather than scrolling its
 * own list inside the dialog's pane.
 */
import { PageFrame, PageHeader } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ArchivedSessionsSection } from "../settings/archived-sessions-section";

export function ArchivedPage() {
  useDocumentTitle(S.archivedPage.title);
  return (
    <PageFrame width="lg">
      <PageHeader
        title={S.archivedPage.title}
        description={S.archivedPage.description}
        info={S.archivedPage.info}
      />
      <ArchivedSessionsSection variant="page" initialSource="user" />
    </PageFrame>
  );
}

import { Fold, GroupHeader } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { DRAFTS_GROUP_KEY, NEW_CHAT_ICON } from "../../lib/main-sidebar-persistence";
import { DraftRow } from "./main-draft-row";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainListDrafts(scope: MainSidebarState) {
  const {
    activeSessionId,
    collapsedGroups,
    setDeletingDraft,
    toggleGroup,
    searching,
    shownDrafts,
    go,
  } = scope;
  return (
    shownDrafts.length > 0 && (
      <div className="pt-2.5">
        <GroupHeader
          open={searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)}
          onToggle={() => toggleGroup(DRAFTS_GROUP_KEY)}
          glyph={NEW_CHAT_ICON}
          label={S.chat.draftGroup}
          uppercase
          count={shownDrafts.length}
        />
        <Fold open={searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)}>
          <ul className="space-y-px">
            {shownDrafts.map((entry) => (
              <DraftRow
                key={entry.id}
                entry={entry}
                active={entry.id === activeSessionId}
                onOpen={() => go(`/chat/${entry.id}`)}
                onDelete={() => setDeletingDraft(entry)}
              />
            ))}
          </ul>
        </Fold>
      </div>
    )
  );
}

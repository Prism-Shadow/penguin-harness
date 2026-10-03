import { ICONS, NAV_FILL } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { Icon } from "../../components/ui/group-list";
import { Truncated } from "../../components/ui/truncated";
import { draftSessionTitle, type DraftSessionEntry } from "../chat";

export function DraftRow({
  entry,
  active,
  onOpen,
  onDelete,
}: {
  entry: DraftSessionEntry;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = draftSessionTitle(entry) || S.chat.draftUntitled;
  return (
    <li>
      <div
        // Same truncated-title scroll reveal as the session rows (#309).
        data-title-reveal
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active ? NAV_FILL.selected : NAV_FILL.hover
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          <Truncated
            scrollReveal
            text={title}
            // The conversation rows' inks (SessionRow), so a parked draft reads as one of them.
            className={`min-w-0 flex-1 font-sans text-sm ${
              active ? "font-medium text-fg" : "text-fg/80"
            }`}
          />
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            data-tooltip={S.chat.deleteDraft}
            aria-label={S.chat.deleteDraft}
            onClick={onDelete}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-gray-300/60 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-red-400"
          >
            <Icon d={ICONS.trash} size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

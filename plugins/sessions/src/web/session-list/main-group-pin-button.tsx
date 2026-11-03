import { ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { Icon } from "../../components/ui/group-list";

export function GroupPinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-tooltip={pinned ? S.nav.unpinGroup : S.nav.pinGroup}
      aria-label={S.nav.pinGroup}
      aria-pressed={pinned}
      onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-[opacity,background-color,color] duration-150 hover:bg-fg/7 hover:text-fg ${
        pinned
          ? "text-fg-muted"
          : "text-fg-subtle opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100"
      }`}
    >
      <Icon d={ICONS.pin} size={ICON_SIZE.groupHeaderAction} />
    </button>
  );
}

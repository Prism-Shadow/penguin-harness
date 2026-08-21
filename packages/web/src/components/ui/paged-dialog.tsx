/**
 * PagedDialog: a large modal whose left rail switches sub-pages — the shared shell for
 * multi-page settings surfaces (System settings today; Project settings converges on the
 * same shell). Purely presentational: the caller owns which pages exist, which one is
 * active, and what the pane renders; the shell draws the rail (grouped, icon + label,
 * solid-fill active row — the sidebar's convention), the pane heading, and the close
 * control.
 *
 * Built on Modal, so it inherits the portal, the Escape layer stack (nested dialogs and
 * menus close in visual order) and the bottom-sheet posture on narrow screens — where the
 * rail folds into a horizontal scroller above the pane and group headings are dropped
 * along with the second dimension (Tabs' convention).
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../lib/icon-scale";
import { Modal } from "./modal";
import { CloseButton } from "./icons";
import { InfoPopover } from "./info-popover";

export interface PagedDialogItem<K extends string> {
  key: K;
  label: string;
  /** Small leading glyph in the rail; sized by the caller (16px reads well). */
  icon?: ReactNode;
  /**
   * The page's semantic explanation, disclosed by a "?" beside the pane heading. It belongs
   * here rather than at the top of the page body because the heading is the only title a page
   * has — a "?" inside the body would be a mark modifying nothing, and a paragraph there would
   * be re-read on every visit.
   */
  info?: ReactNode;
}

export interface PagedDialogGroup<K extends string> {
  key: string;
  /** Rail heading; omitted entirely when the dialog has a single group (a lone heading implies a second). */
  label?: string;
  items: ReadonlyArray<PagedDialogItem<K>>;
}

/** Rail entry: solid gray fill when active, gray hover otherwise (the sidebar's convention). */
const railItemClass = (active: boolean) =>
  `flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
  }`;

export function PagedDialog<K extends string>({
  open,
  onClose,
  title,
  groups,
  active,
  onSelect,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Dialog name for assistive tech; the visible heading is the active page's label. */
  title: string;
  groups: ReadonlyArray<PagedDialogGroup<K>>;
  active: K;
  onSelect: (key: K) => void;
  /** The active page's content. */
  children: ReactNode;
}) {
  const showGroupHeadings = groups.length > 1;
  const activeItem = groups.flatMap((g) => g.items).find((item) => item.key === active);
  const activeLabel = activeItem?.label ?? title;

  return (
    <Modal open={open} onClose={onClose} title={title} headerless bare widthClass="sm:max-w-3xl">
      <div className="flex h-[min(40rem,85vh)] flex-col sm:flex-row">
        {/* Rail: vertical on desktop, a horizontal scroller above the pane on narrow screens. */}
        <nav
          aria-label={title}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-100 p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3 dark:border-gray-800"
        >
          {groups.map((group) => (
            <div key={group.key} className="contents sm:mt-3 sm:block sm:first:mt-0">
              {showGroupHeadings && group.label !== undefined && (
                <p className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 sm:block dark:text-gray-500">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={railItemClass(item.key === active)}
                  aria-current={item.key === active ? "page" : undefined}
                  onClick={() => onSelect(item.key)}
                >
                  {item.icon !== undefined && (
                    <span aria-hidden className="shrink-0 text-gray-400 dark:text-gray-500">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
            <h2 className={`flex min-w-0 items-center ${ICON_GAP.tight} text-lg font-semibold`}>
              {activeLabel}
              {activeItem?.info !== undefined && (
                <InfoPopover label={activeLabel}>{activeItem.info}</InfoPopover>
              )}
            </h2>
            <CloseButton onClose={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
            {children}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The header row of one draft-screen example folder.
 *
 * A tab, not a disclosure: the open folder stays open (clicking it is a no-op) and carries the
 * block's whole body, so exactly one folder's rows are ever on screen. It lives in its own module
 * because two callers render it — the built-in folders in draft-view.tsx and the user's own
 * shortcuts folder in shortcuts-folder.tsx — and a folder row that reads differently from its
 * neighbours would be read as a different kind of thing.
 */
import { Chevron } from "../../components/ui/chevron";
import { ICON_SIZE } from "../../lib/icon-scale";

export function ExampleFolderRow({
  open,
  glyph,
  label,
  count,
  onOpen,
}: {
  open: boolean;
  /** 24x24 path for the folder's own mark — what the eye scans to pick a category. */
  glyph: string;
  label: string;
  /** Rows inside the folder, shown right of the name — a bare count, or `used/limit` where one applies. */
  count: number | string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 ${
        open ? "bg-gray-100 dark:bg-gray-800/70" : "hover:bg-gray-100 dark:hover:bg-gray-800/70"
      }`}
    >
      <span className="shrink-0 text-brand-500 dark:text-brand-400">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d={glyph} />
        </svg>
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{count}</span>
      <Chevron open={open} size={ICON_SIZE.chevron} className="text-gray-400" />
    </button>
  );
}

/**
 * The class string of one row inside an open folder — an example, or a saved shortcut. Shared for
 * the same reason as the header: the two lists sit in the same block and must read as one list
 * shape. Layout (flex, width) is the caller's, since a shortcut row also carries its own actions.
 */
export const exampleRowClass =
  "rounded-md px-2 py-1.5 text-left text-sm text-gray-600 transition-colors duration-150 " +
  "hover:bg-gray-100 hover:text-gray-900 disabled:cursor-default disabled:opacity-60 " +
  "disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200";

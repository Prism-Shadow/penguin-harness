/**
 * Shared shell of the user menu's update rows — the server self-update row and the
 * desktop client-update row render the same anatomy (leading spinner or accent dot,
 * truncating label, right-aligned version chip) and must not drift apart visually, so
 * the markup lives once here. Behavior stays with the callers; `menuItemClass` is
 * owned by sidebar.tsx like every other row's.
 */
export function UpdateMenuRow({
  menuItemClass,
  label,
  chip,
  busy = false,
  dot = false,
  disabled = false,
  title,
  onClick,
}: {
  menuItemClass: string;
  label: string;
  /** Right-aligned version chip (e.g. `v1.2.3`); null renders none. */
  chip: string | null;
  /** Leading spinner; wins over the dot. */
  busy?: boolean;
  /** Leading accent dot — the "something actionable is waiting" marker. */
  dot?: boolean;
  disabled?: boolean;
  /** Row tooltip (the "last updated" date, an unsupported-form reason). */
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...(title !== undefined ? { title } : {})}
      className={`${menuItemClass} flex items-center justify-between gap-2 disabled:cursor-default disabled:opacity-60`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {busy && (
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
          />
        )}
        {!busy && dot && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-bg)]" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {chip !== null && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{chip}</span>
      )}
    </button>
  );
}

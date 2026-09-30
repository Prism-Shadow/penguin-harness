/**
 * A keyboard hint: the keys of one shortcut, each on its own key cap, in the order they are
 * pressed (`["Ctrl", "`"]`). The outer `<kbd>` holding one `<kbd>` per key is HTML's own markup
 * for a key combination, so assistive technology reads it as keys rather than as prose.
 *
 * The caller supplies the keys as the platform names them; the hint never guesses a platform.
 */
export function Kbd({ keys, className = "" }: { keys: readonly string[]; className?: string }) {
  return (
    <kbd className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {keys.map((key, i) => (
        <kbd
          key={`${i}:${key}`}
          className="rounded-sm border border-line bg-surface-inset px-1 font-mono text-xs text-fg-muted"
        >
          {key}
        </kbd>
      ))}
    </kbd>
  );
}

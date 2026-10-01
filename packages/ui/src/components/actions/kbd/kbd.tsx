/**
 * A keyboard hint: the keys of one shortcut, in the order they are pressed (`["Ctrl", "`"]`).
 * The outer `<kbd>` holding one `<kbd>` per key is HTML's own markup for a key combination, so
 * assistive technology reads it as keys rather than as prose.
 *
 * Two looks:
 * - `caps` (the default): each key on its own key cap, for a hint standing on its own;
 * - `plain`: the keys as mono text joined by `+`, no cap chrome, in the caller's ink — for a hint
 *   inside something that already has a frame (a menu row, a settings control).
 *
 * The caller supplies the keys as the platform names them; the hint never guesses a platform. A
 * platform that writes a chord as one glyph run (`⌘W`) passes it as a single key.
 */
import { Fragment } from "react";

export function Kbd({
  keys,
  variant = "caps",
  className = "",
}: {
  keys: readonly string[];
  variant?: "caps" | "plain";
  className?: string;
}) {
  if (variant === "plain") {
    return (
      <kbd className={`inline-flex shrink-0 items-center font-mono text-xs ${className}`}>
        {keys.map((key, i) => (
          <Fragment key={`${i}:${key}`}>
            {i > 0 && <span aria-hidden>+</span>}
            <kbd>{key}</kbd>
          </Fragment>
        ))}
      </kbd>
    );
  }
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

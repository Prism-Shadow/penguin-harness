/**
 * The media an asset has now beside what would replace it, so a new take is judged against
 * the one it replaces before it replaces it. Nothing changes until "Use new" is pressed;
 * "Keep current" puts the new one aside, where it stays in the candidates or the library.
 */
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";

export function MediaComparison({
  current,
  next,
  disabled,
  onUse,
  onKeep,
  useLabel,
  keepLabel,
}: {
  current: ReactNode;
  next: ReactNode;
  disabled: boolean;
  onUse: () => void;
  onKeep: () => void;
  /** The two actions' words, where a kind of media names them itself. */
  useLabel?: string;
  keepLabel?: string;
}) {
  const words = S.activities.mediaComparison;
  return (
    <section
      aria-label={words.title}
      className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
    >
      <h5 className="text-xs font-semibold">{words.title}</h5>
      <div className="grid gap-3 sm:grid-cols-2">
        <figure aria-label={words.current} className="min-w-0 space-y-1">
          <figcaption className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {words.current}
          </figcaption>
          {current}
        </figure>
        <figure aria-label={words.next} className="min-w-0 space-y-1">
          <figcaption className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {words.next}
          </figcaption>
          {next}
        </figure>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={disabled} onClick={onUse}>
          {useLabel ?? words.use}
        </Button>
        <Button size="sm" variant="ghost" onClick={onKeep}>
          {keepLabel ?? words.keep}
        </Button>
      </div>
    </section>
  );
}

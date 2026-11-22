/**
 * What a destructive action will reach, inside its confirm: one line per thing it reaches — its
 * name, and where it lives in quieter ink after it ("Notes Agent · Mia's Project") — up to `limit`
 * of them, then one line saying how many more. A count of none draws nothing; while the list is
 * being asked for, the `pending` line stands in its place, so the confirm never shows a number it
 * does not know yet.
 *
 * Domain-free: the host says what each item is called and where it is, in its own words.
 */
import type { ReactNode } from "react";

export interface ImpactItem {
  /** A stable key: two items may share a name. */
  key: string;
  /** The thing itself (an Agent's name). */
  name: ReactNode;
  /** Where it lives, said after it in quieter ink (its Project); absent: nothing more. */
  where?: ReactNode;
}

export interface ImpactListProps {
  /** Null while the host is still asking what the action reaches. */
  items: readonly ImpactItem[] | null;
  /** How many are named before the rest are counted (default 5). */
  limit?: number;
  /** The line counting the rest, past the limit. */
  more: (count: number) => ReactNode;
  /** The line shown while `items` is null. */
  pending: ReactNode;
  className?: string;
}

export function ImpactList({ items, limit = 5, more, pending, className = "" }: ImpactListProps) {
  if (items === null) {
    return (
      <p className={`text-xs text-fg-muted ${className}`} aria-busy="true">
        {pending}
      </p>
    );
  }
  if (items.length === 0) return null;
  const named = items.slice(0, limit);
  const rest = items.length - named.length;
  return (
    <ul className={`space-y-1 text-sm ${className}`} data-testid="impact-list">
      {named.map((item) => (
        <li key={item.key} className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate">{item.name}</span>
          {item.where !== undefined && (
            <span className="min-w-0 shrink truncate text-xs text-fg-muted">{item.where}</span>
          )}
        </li>
      ))}
      {rest > 0 && <li className="text-xs text-fg-muted">{more(rest)}</li>}
    </ul>
  );
}

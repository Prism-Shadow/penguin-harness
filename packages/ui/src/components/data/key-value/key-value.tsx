/**
 * Label/value pairs: a description list laid out as two columns, the labels as wide as the
 * longest one and the values taking the rest. A version, a count, a date or a path sits in the
 * value column, so the list sets its figures tabular — numbers in rows above each other align.
 *
 * A value that is an identifier (an id, a path, a command) takes `mono`; every value breaks
 * anywhere rather than widen the list.
 */
import type { ReactNode } from "react";

export type KeyValueSize = "xs" | "sm";

const SIZE: Record<KeyValueSize, string> = {
  xs: "gap-y-1.5 text-xs",
  sm: "gap-y-1 text-sm",
};

export interface KeyValueProps {
  /** `xs` in a card or a detail block (the default), `sm` in a dialog's body. */
  size?: KeyValueSize;
  className?: string;
  /** The pairs, as `KeyValueRow`s. */
  children?: ReactNode;
}

export function KeyValue({ size = "xs", className = "", children }: KeyValueProps) {
  return (
    <dl
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 tabular-nums ${SIZE[size]} ${className}`}
    >
      {children}
    </dl>
  );
}

export interface KeyValueRowProps {
  label: ReactNode;
  /** The value is an identifier: an id, a path, a command. */
  mono?: boolean;
  children?: ReactNode;
}

/** One pair: the label in the muted ink, the value in the body ink. */
export function KeyValueRow({ label, mono = false, children }: KeyValueRowProps) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`min-w-0 text-fg [overflow-wrap:anywhere] ${mono ? "font-mono" : ""}`}>
        {children}
      </dd>
    </>
  );
}

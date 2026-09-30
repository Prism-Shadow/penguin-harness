/**
 * Chrome controls, styled by chrome.css only: a segmented control and a swatch row for the accent
 * — each swatch painted in the colour it would apply, so the row previews the theme's palette
 * before anything is chosen. The select for the longer option lists is chrome/select.tsx.
 */
import type { CSSProperties, ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A hint shown on hover and focus, for a segment whose label is short or an icon. */
  hint?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="g-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.hint}
          data-tooltip={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface SwatchOption {
  value: string;
  /** The name shown on hover and read to assistive technology. */
  label: string;
  /** The colour the swatch is painted in; empty until the probe has resolved it. */
  color: string;
}

export function Swatches({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly SwatchOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="g-swatches" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="g-swatch"
          aria-pressed={option.value === value}
          aria-label={option.label}
          data-tooltip={option.label}
          data-empty={option.color === "" || undefined}
          style={{ "--g-swatch": option.color || "transparent" } as CSSProperties}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

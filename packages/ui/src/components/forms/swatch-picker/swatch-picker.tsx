/**
 * A row of round colour swatches, one pressed: the accent picker's shape. The swatches arrive as
 * data — each with its colour, its name and its value — so which colours a theme offers, and what
 * each is called, stays with the caller; the picker only paints them and says which one is in
 * effect.
 *
 * Each swatch is a toggle button named by its label (`aria-pressed` on the one in effect), with
 * the name in the shared tooltip as well, since a colour dot has no text of its own. The chosen
 * swatch carries a ring; hovering another draws its edge. Nothing scales: a swatch that grows
 * under the pointer is motion with no job.
 */
export interface SwatchOption<T extends string> {
  value: T;
  /** The swatch's fill: any CSS colour. */
  color: string;
  /** The swatch's accessible name and tooltip. */
  label: string;
}

export function SwatchPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<SwatchOption<T>>;
  /** The value in effect (not merely the stored one, when the two can differ). */
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-tooltip={option.label}
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-5 w-5 rounded-full border transition-colors duration-150 ${
            value === option.value
              ? "border-fg-muted ring-2 ring-fg-subtle/50"
              : "border-transparent hover:border-line-emphasis"
          }`}
          style={{ backgroundColor: option.color }}
        />
      ))}
    </div>
  );
}

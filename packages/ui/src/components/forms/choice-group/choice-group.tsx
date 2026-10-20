/**
 * A group of pressable options, drawn in one of two shapes: `chip`, short options in a wrapping
 * row ("Yes / Later / No"), or `card`, a column of options with room for a sentence under each.
 *
 * A single-choice group acts on the press: pressing an option reports it at once, so its options
 * are buttons with `aria-pressed`, not radios — a radio's arrow keys would choose on every step
 * through the list. It keeps a radio group's keyboard all the same: the group is one tab stop,
 * which rests on the option the caller names (`initialStop`), else the pressed one, else the
 * first; the arrow keys on either axis (and Home / End) move it, wrapping at the ends and passing
 * over disabled options; Enter or Space presses. A card leads with the radio's disc, filled on the
 * pressed option, so a single choice reads as one — or with the caller's own mark (`lead`).
 *
 * A multiple-choice group holds any number of options and reports every change as the options
 * that are on, in the options' order whatever order they were pressed in. As chips, each is a
 * toggle button (`aria-pressed`) with its own tab stop, the way each checkbox has one, led by the
 * checkbox's box, ticked once pressed; as cards, each card is a real checkbox's `<label>`, so the
 * browser keeps the keyboard and the state. The box on every option is what tells a multiple
 * choice from a single one at a glance: a square to tick, where a single card has a disc and a
 * single chip nothing.
 *
 * The group is a `role="group"` named by the caller (`aria-labelledby`, or `aria-label`), or left
 * unnamed inside a `<fieldset>` whose legend names it. Disabled, every option dims and takes no
 * press — an answered question still on screen. Pressed, an option takes the accent's line and a
 * wash of it; at rest, the hover darkens the line and fills the box. A `muted` option (an
 * "Other…" entry) is drawn in the muted ink.
 */
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { Checkbox, CheckboxBox } from "../checkbox/checkbox";
import { RadioDisc } from "../radio/radio";
import { restingStop, rovingStop } from "./roving";

export { rovingTarget } from "./roving";

export interface ChoiceGroupOption {
  value: string;
  label: ReactNode;
  /** Card only: a line under the label in the muted ink. */
  description?: ReactNode;
  /** Card + single only: what leads the card; default the RadioDisc (filled when pressed). */
  lead?: ReactNode;
  /** Drawn in the muted ink: the "Other…" entry. */
  muted?: boolean;
  disabled?: boolean;
}

/** What every group takes, single or multiple: the options, their shape, the name, the state. */
interface GroupFrame {
  options: readonly ChoiceGroupOption[];
  shape: "chip" | "card";
  /** The chip's rung: `base` beside reading text, `sm` among a form's controls. A card is base. */
  size?: "base" | "sm";
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  className?: string;
}

export type ChoiceGroupProps = GroupFrame &
  (
    | {
        multiple?: false;
        value: string | null;
        onChange: (value: string) => void;
        /** Which option holds the tab stop at rest; default the pressed one, else the first. */
        initialStop?: string;
      }
    | {
        multiple: true;
        value: readonly string[];
        /** Every option that is on, in the options' order. */
        onChange: (values: string[]) => void;
      }
  );

/**
 * The values a multiple group holds once `value` is pressed: that option turns over and the rest
 * keep their state, listed in the options' order. A held value no option offers is dropped.
 */
export function toggledValues(
  options: readonly ChoiceGroupOption[],
  values: readonly string[],
  value: string,
): string[] {
  const on = !values.includes(value);
  return options
    .map((option) => option.value)
    .filter((each) => (each === value ? on : values.includes(each)));
}

/** The keyboard ring of a pressable option, the theme's own. */
const FOCUS_RING =
  "focus-visible:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

/**
 * Shared by the chip and the card: the line, the colour-only motion, focus, and the closed state,
 * which dims the way a disabled checkbox dims.
 */
const PRESSABLE =
  "border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 " +
  FOCUS_RING;

/**
 * A chip: one short option in a wrapping row, the control's shape. The padding never falls under
 * the radius, so a label clears a pill's curve, and the label stays on one line: the row wraps.
 */
const CHIP: Readonly<Record<"base" | "sm", string>> = {
  base: `whitespace-nowrap rounded-control px-3 py-1.5 text-sm ${PRESSABLE}`,
  sm: `whitespace-nowrap rounded-control px-3 py-1 text-xs ${PRESSABLE}`,
};

/**
 * A card: the lead in the first column, the label and its description in the second. The box's
 * radius is the md rung and its side padding at least that, so the text clears the corners in
 * every theme.
 */
const CARD =
  "grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-md px-3 py-2 " +
  `text-left text-base ${PRESSABLE}`;

/**
 * A pressable option's state. Chosen where the state is known rather than through an
 * `aria-pressed:` variant, because an `enabled:hover:` rule outranks an `aria-pressed:` one on
 * specificity and a pressed option under the pointer would lose its accent line.
 */
function pressLook(pressed: boolean): string {
  return pressed
    ? "border-accent bg-accent-muted"
    : "border-line bg-control enabled:hover:border-line-emphasis enabled:hover:bg-control-hover";
}

/**
 * A checkbox card's state, the same looks on the checkbox's `<label>`. A label has no enabled
 * state for an `enabled:` variant to read, so the hover is left out while the option is closed.
 */
function checkLook(checked: boolean, disabled: boolean): string {
  const look = checked
    ? "border-accent bg-accent-muted"
    : disabled
      ? "border-line bg-control"
      : "border-line bg-control hover:border-line-emphasis hover:bg-control-hover";
  return `w-full rounded-md border px-3 py-2 transition-colors duration-150 ${look}`;
}

const ink = (option: ChoiceGroupOption) => (option.muted === true ? "text-fg-muted" : "text-fg");

/** A card's description under its label, a rung down in the muted ink. */
function CardText({ option }: { option: ChoiceGroupOption }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span>{option.label}</span>
      {option.description != null && (
        <span className="text-sm text-fg-muted">{option.description}</span>
      )}
    </span>
  );
}

/** The group's element: its role, its name, and the row or the column its options sit in. */
function frameProps(props: GroupFrame) {
  const layout = props.shape === "chip" ? "flex flex-wrap gap-2" : "flex flex-col gap-2";
  return {
    role: "group",
    "aria-labelledby": props["aria-labelledby"],
    "aria-label": props["aria-label"],
    "data-control": "choice-group",
    className: `${layout} ${props.className ?? ""}`,
  };
}

function SingleChoiceGroup(
  props: GroupFrame & {
    value: string | null;
    onChange: (value: string) => void;
    initialStop?: string;
  },
) {
  const { options, shape, size = "base", disabled = false, value, onChange, initialStop } = props;
  const enabled = options.map((option) => !disabled && option.disabled !== true);
  const pressedAt = options.findIndex((option) => option.value === value);
  const [stop, setStop] = useState(() =>
    restingStop(enabled, [options.findIndex((option) => option.value === initialStop), pressedAt]),
  );
  // An option that has gone, or can no longer take focus, gives the stop back to the rule.
  const at = enabled[stop] === true ? stop : restingStop(enabled, [pressedAt]);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingStop(at, event.key, enabled);
    if (next === null) return;
    event.preventDefault();
    setStop(next);
    buttons.current[next]?.focus();
  };

  return (
    <div {...frameProps(props)} onKeyDown={onKeyDown}>
      {options.map((option, i) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[i] = element;
            }}
            type="button"
            tabIndex={i === at ? 0 : -1}
            disabled={!enabled[i]}
            aria-pressed={pressed}
            onFocus={() => setStop(i)}
            // A click does not focus a button in every browser, so the press moves the stop too.
            onClick={() => {
              setStop(i);
              onChange(option.value);
            }}
            className={`${shape === "chip" ? CHIP[size] : CARD} ${pressLook(pressed)} ${ink(option)}`}
          >
            {shape === "chip" ? (
              option.label
            ) : (
              <>
                {/* One line tall and the disc's width, so the mark centres on the label's first
                    line and every label in the column starts at one edge. */}
                <span aria-hidden className="flex h-[1lh] w-3.5 items-center justify-center">
                  {option.lead ?? <RadioDisc on={pressed} />}
                </span>
                <CardText option={option} />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MultipleChoiceGroup(
  props: GroupFrame & { value: readonly string[]; onChange: (values: string[]) => void },
) {
  const { options, shape, size = "base", disabled = false, value, onChange } = props;
  const press = (option: ChoiceGroupOption) =>
    onChange(toggledValues(options, value, option.value));
  return (
    <div {...frameProps(props)}>
      {options.map((option) => {
        const on = value.includes(option.value);
        const closed = disabled || option.disabled === true;
        return shape === "chip" ? (
          <button
            key={option.value}
            type="button"
            disabled={closed}
            aria-pressed={on}
            onClick={() => press(option)}
            className={`${CHIP[size]} inline-flex items-center gap-1.5 ${pressLook(on)} ${ink(option)}`}
          >
            <CheckboxBox on={on} />
            {option.label}
          </button>
        ) : (
          <Checkbox
            key={option.value}
            checked={on}
            onChange={() => press(option)}
            label={option.label}
            hint={
              option.description != null ? (
                <span className="mt-1 block text-sm">{option.description}</span>
              ) : undefined
            }
            size="base"
            disabled={closed}
            className={`${checkLook(on, closed)} ${ink(option)}`}
          />
        );
      })}
    </div>
  );
}

export function ChoiceGroup(props: ChoiceGroupProps): ReactElement {
  return props.multiple === true ? (
    <MultipleChoiceGroup {...props} />
  ) : (
    <SingleChoiceGroup {...props} />
  );
}

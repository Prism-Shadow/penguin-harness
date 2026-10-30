/**
 * A press that reads as text — Retry, Retry now, Stop retrying, Go to Machines, Expand — for an
 * action that sits in a line of status words, where a boxed button would outweigh the line it
 * belongs to (the transcript's "[Aborted]: …" marker, a retry row, a load failure).
 *
 * Two looks, one switch. `link`: the theme's link ink, underlined on hover (and at rest where the
 * theme's links are underlined). `bracket`: the word in square brackets in the body ink, the
 * transcript marker's own shape ("[重试]" beside "[已中断]"), the word underlined on hover.
 * {@link TEXT_ACTION_LOOK} is the look the app uses; a caller passes `look` only to show both
 * (the gallery).
 *
 * It is a real button: the keyboard reaches it, the shared focus ring draws round it, and a
 * screen reader names it by its word alone (the brackets are hidden from it). It takes the size
 * and the face of the text around it — mono in a mono line — and keeps its words on one line. A
 * busy press spins before its word and takes no press; a disabled one fades.
 */
import type { ButtonHTMLAttributes } from "react";
import { useUiStrings } from "../../../strings";
import { Spinner } from "../../icons/spinner/spinner";

export type TextActionLook = "link" | "bracket";

/** The look every text action in the app takes. */
export const TEXT_ACTION_LOOK: TextActionLook = "link";

export interface TextActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Defaults to the app's look; pass it only to show a specific one. */
  look?: TextActionLook;
  /** The press's request is in flight: it spins and takes no press. */
  busy?: boolean;
  /** What the spinner announces while busy; the interface's busy word when omitted. */
  busyLabel?: string;
}

/** Each look's ink; the word (not the brackets) takes the hover underline. */
const LOOK: Readonly<Record<TextActionLook, { ink: string; word: string }>> = {
  link: {
    ink: "text-link hover:text-link-hover [text-decoration-line:var(--ui-link-decoration)]",
    word: "group-hover:underline group-disabled:no-underline",
  },
  bracket: { ink: "text-fg", word: "group-hover:underline group-disabled:no-underline" },
};

export function TextAction({
  look = TEXT_ACTION_LOOK,
  busy = false,
  busyLabel,
  disabled,
  className = "",
  children,
  ...rest
}: TextActionProps) {
  const strings = useUiStrings();
  const style = LOOK[look];
  return (
    <button
      type="button"
      {...rest}
      data-text-action={look}
      aria-busy={busy || undefined}
      disabled={disabled === true || busy}
      className={`group inline-flex shrink-0 cursor-pointer items-baseline gap-1 whitespace-nowrap rounded-sm underline-offset-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${style.ink} ${className}`}
    >
      {busy && (
        <span className="self-center">
          <Spinner size="xs" label={busyLabel ?? strings.loading} />
        </span>
      )}
      {/* One run of text, so the brackets hug the word. */}
      <span>
        {look === "bracket" && <span aria-hidden="true">[</span>}
        <span className={style.word}>{children}</span>
        {look === "bracket" && <span aria-hidden="true">]</span>}
      </span>
    </button>
  );
}

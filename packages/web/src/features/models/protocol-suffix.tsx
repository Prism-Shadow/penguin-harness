/**
 * The protocol control that lives INSIDE the right edge of the config dialog's base URL
 * field — it is the grey protocol-path suffix that field always had, promoted from a
 * passive label into the protocol picker itself.
 *
 * The suffix already displayed the very thing this control selects: the path the AgentHub
 * client appends to the base URL (`/responses` / `/v1/messages` / `/chat/completions`),
 * which is one-to-one with the three generic protocol clients. So protocol selection
 * reuses that component rather than occupying a form row of their own: the trigger keeps
 * showing the live path, and clicking it opens a menu of the three protocols (name as the
 * row title, the appended path as its description) — the manual override.
 *
 * Selection only. The detect ACTION lives at the base URL field's top-right, next to its
 * label (per maintainer: same placement idiom as the API key field's "get API key" link),
 * because detection is gated on the API key and a disabled menu row cannot carry that
 * reason where the user is looking. This menu still *reflects* a run in progress — the
 * trigger spins, and an inconclusive run tints it amber — since the value being determined
 * is the one it displays.
 *
 * Built on the shared Dropdown primitive in portal mode, which is what makes this safe
 * inside a Modal at phone widths: the panel is mounted on document.body at fixed viewport
 * coordinates (no ancestor overflow can clip it), clamped to stay on-screen, flipped up
 * when there is no room below, capped to the room it does have, and wired into the shared
 * Escape-layer stack plus arrow-key navigation.
 *
 * State is rendered without ever changing the trigger's width, so the in-field padding the
 * base URL input reserves for it never has to move: "detecting" swaps the chevron for a
 * spinner of the same box, and the warning state (nothing matched / detection failed) is
 * colour-only. The message itself goes in the base URL field's own text slot below — see
 * the call site — so no extra row appears in the happy path.
 */
import { useState } from "react";
import { Dropdown } from "../../components/ui/dropdown";
import { CheckIcon, ChevronDown } from "../../components/ui/icons";
import { menuRowClass } from "../../components/ui/field";
import { S } from "../../lib/strings";
import { protocolPathForModel } from "./protocol-path";
import { PROTOCOL_CLIENT_TYPES } from "./protocol-types";
import type { ProtocolClientType } from "./protocol-types";

/** Whether the last detection run left something to warn about (drives the amber trigger). */
export type ProtocolDetectTone = "ok" | "warn" | null;

export function ProtocolSuffixMenu({
  value,
  path,
  detecting,
  tone,
  onPick,
}: {
  /** Protocol the selector currently represents (legacy `openai` / empty display as openai-chat). */
  value: ProtocolClientType;
  /** Path text on the trigger — the live suffix, kept identical to what the read-only span showed. */
  path: string;
  /** A detection run is in flight (started from the field's top-right button). */
  detecting: boolean;
  /** `warn` paints the trigger amber (nothing matched / detection failed); the wording lives below the field. */
  tone: ProtocolDetectTone;
  onPick: (clientType: ProtocolClientType) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = S.models.protocolNames[value] ?? value;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex"
      // Right-aligned under the field's right edge, where the trigger sits; Dropdown still
      // clamps the panel into the viewport, so a phone-width dialog keeps every row on screen.
      menuClass="w-72 max-w-[calc(100vw-2rem)] origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${S.models.protocol}: ${name}`}
          title={S.models.protocolTriggerTitle(name)}
          onClick={() => setOpen((v) => !v)}
          className={
            "flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs transition-colors duration-150 " +
            "hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400/30 dark:hover:bg-gray-800 " +
            (tone === "warn"
              ? "text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400"
              : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200")
          }
        >
          <span className="truncate">{path}</span>
          {/* Same 10px box as the chevron it replaces: switching to the busy state must not
              resize the trigger, or the input's reserved padding would jump mid-detection. */}
          {detecting ? (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
            />
          ) : (
            <ChevronDown size={10} />
          )}
        </button>
      }
    >
      <div role="menu">
        {PROTOCOL_CLIENT_TYPES.map((t) => {
          const selected = t === value;
          return (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => {
                setOpen(false);
                onPick(t);
              }}
              className={`block ${menuRowClass} hover:bg-gray-100 dark:hover:bg-gray-800 ${
                selected ? "bg-gray-100 dark:bg-gray-800" : ""
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`min-w-0 truncate text-xs ${
                    selected
                      ? "font-medium text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {S.models.protocolNames[t] ?? t}
                </span>
                {selected && <CheckIcon className="text-gray-500 dark:text-gray-400" />}
              </span>
              {/* The path this protocol appends: the same string the trigger shows, so the
                  menu explains what the suffix in the field means. */}
              <span className="mt-0.5 block font-mono text-[11px] text-gray-500 dark:text-gray-500">
                {protocolPathForModel("custom", t)}
              </span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}

/**
 * Choose a narration's voice: a trigger that names the voice, and a panel to search the
 * catalogue by name or id, narrow it by provider, model and language, and listen to a
 * voice's sample where the provider publishes one. The derivations live in
 * voice-catalogue.ts; this file only draws them.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VoiceOption } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Field, controlBase, menuRowClass } from "../../components/ui/field";
import { CheckIcon, ChevronDown } from "../../components/ui/icons";
import { Input, sizeClass } from "../../components/ui/input";
import { rowDescClass } from "../../components/ui/option-menu";
import { Select } from "../../components/ui/select";
import { usePortalPanel } from "../../components/ui/use-portal-panel";
import { S } from "../../lib/strings";
import {
  NO_VOICE_FILTERS,
  facetValues,
  filterVoices,
  shownFacet,
  voiceDetails,
  type VoiceFilters,
} from "./voice-catalogue";

const PANEL_WIDTH = 320;

/** Whether another portaled menu (a filter's) is open over this panel. */
function nestedMenuOpen(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  return [...document.body.children].some(
    (element) => element !== panel && element.getAttribute("role") === "listbox",
  );
}

export function VoicePicker({
  options,
  value,
  onChange,
  label,
  showLabel = true,
  hint,
  disabled,
}: {
  options: readonly VoiceOption[];
  /** The chosen voice's id, "mixed" when narrations differ, or null for none chosen. */
  value: string | "mixed" | null;
  onChange: (id: string) => void;
  /** The field's name; also the trigger's and the list's accessible name. */
  label: string;
  /** Draw the name above the trigger; off where the row already says what it is. */
  showLabel?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  const words = S.activities.voicePicker;
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<VoiceFilters>(NO_VOICE_FILTERS);
  const [playing, setPlaying] = useState<string | null>(null);
  // The option last focused; its sample is the one Preview plays.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const listId = useId();
  const close = () => {
    setOpen(false);
    setHighlighted(null);
    audio.current?.pause();
    setPlaying(null);
  };
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    // A filter's own menu is portaled beside this panel, so a click or Esc in it closes
    // that menu alone; the panel stays open around it.
    onClose: () => {
      if (!nestedMenuOpen(panelRef.current)) close();
    },
    estimatedHeight: 360,
    panelWidth: PANEL_WIDTH,
  });
  // Focus the search once the panel is placed. Without preventScroll, focusing it scrolls
  // the page toward the panel, and a scroll that moves the trigger closes the panel.
  const placed = open && !!position;
  useEffect(() => {
    if (placed) panelRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [placed, panelRef]);
  // A disabled picker never keeps a panel open behind it.
  useEffect(() => {
    if (disabled && open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, open]);
  const current = value && value !== "mixed" ? options.find((o) => o.id === value) : undefined;
  const text =
    value === "mixed" ? words.mixed : (current?.label ?? (value ? value : words.default));
  const facets = facetValues(options);
  const shown = filterVoices(options, filters);
  // A listbox owns only options, so the preview control sits below the list and plays the
  // focused voice, or the chosen one before any has focus.
  const previewed =
    shown.find((option) => option.id === highlighted) ??
    shown.find((option) => option.id === current?.id);
  const filtered = !!filters.query || !!filters.provider || !!filters.model || !!filters.language;
  function choose(id: string) {
    onChange(id);
    close();
  }
  function highlight(id: string) {
    // Preview names one voice, so a sample of another stops when focus moves on.
    if (playing && playing !== id) {
      audio.current?.pause();
      setPlaying(null);
    }
    setHighlighted(id);
  }
  function preview(option: VoiceOption) {
    const player = audio.current;
    if (!player || !option.previewUrl) return;
    if (playing === option.id) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.src = option.previewUrl;
    setPlaying(option.id);
    void player.play().catch(() => setPlaying(null));
  }
  const facet = (
    key: "provider" | "model" | "language",
    title: string,
    values: readonly string[],
  ) =>
    shownFacet(values) && (
      <Select
        size="sm"
        label={title}
        value={filters[key]}
        onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
      >
        <option value="">{words.anyValue}</option>
        {values.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </Select>
    );
  // The trigger copies the Select trigger (field chrome, chevron, full width) rather than
  // the shared Button on purpose: it stands where a Select stood and opens a list to choose
  // from, so it reads as a field beside the other Selects. It keeps the small size.
  const trigger = (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${text}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex w-full items-center justify-between gap-2 ${controlBase} ${sizeClass.sm} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="min-w-0 truncate">{text}</span>
        <ChevronDown className="text-gray-400" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
            }}
            className="anim-pop z-[60] flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            <Input
              size="sm"
              type="search"
              aria-label={words.search}
              aria-controls={listId}
              placeholder={words.search}
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && shown.length === 1) {
                  event.preventDefault();
                  choose(shown[0]!.id);
                }
              }}
            />
            {(shownFacet(facets.providers) ||
              shownFacet(facets.models) ||
              shownFacet(facets.languages)) && (
              <div className="grid grid-cols-2 gap-2">
                {facet("provider", words.provider, facets.providers)}
                {facet("model", words.model, facets.models)}
                {facet("language", words.language, facets.languages)}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <p aria-live="polite" className="text-xs text-gray-500 dark:text-gray-400">
                {words.count(shown.length)}
              </p>
              {filtered && (
                <Button size="sm" variant="ghost" onClick={() => setFilters(NO_VOICE_FILTERS)}>
                  {words.resetFilters}
                </Button>
              )}
            </div>
            {shown.length ? (
              <div
                id={listId}
                role="listbox"
                aria-label={label}
                className="-mx-2 min-h-0 flex-1 overflow-y-auto"
              >
                {shown.map((option) => {
                  const selected = option.id === value;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(option.id)}
                      onFocus={() => highlight(option.id)}
                      className={`block w-full ${menuRowClass} hover:bg-gray-100 dark:hover:bg-gray-800 ${
                        selected ? "bg-gray-100 dark:bg-gray-800" : ""
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs ${
                            selected
                              ? "font-medium text-gray-900 dark:text-gray-100"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {option.label}
                          {option.description ? ` · ${option.description}` : ""}
                        </span>
                        {selected && <CheckIcon className="text-gray-500 dark:text-gray-400" />}
                      </span>
                      <span
                        className={`mt-0.5 block ${rowDescClass.sm} text-gray-500 dark:text-gray-400`}
                      >
                        {words.id(option.id)}
                      </span>
                      <span className={`block ${rowDescClass.sm} text-gray-500 dark:text-gray-400`}>
                        {[
                          ...voiceDetails(option),
                          ...(option.languages.length ? [] : [words.allLanguages]),
                        ].join(" · ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{words.noMatches}</p>
            )}
            {previewed?.previewUrl && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={playing === previewed.id}
                  onClick={() => preview(previewed)}
                >
                  {playing === previewed.id
                    ? words.pause(previewed.label)
                    : words.preview(previewed.label)}
                </Button>
              </div>
            )}
            <audio ref={audio} hidden preload="none" onEnded={() => setPlaying(null)} />
          </div>,
          document.body,
        )}
    </>
  );
  if (!showLabel) return hint ? <Field hint={hint}>{trigger}</Field> : trigger;
  return (
    <Field label={label} hint={hint}>
      {trigger}
    </Field>
  );
}

/**
 * Rows other modules add to the stream's menu for a web link (`ChatModule.linkActions`), recorded
 * by the chat module at boot in their order and read by the menu (stream-selection-menu.tsx). A
 * row is drawn while its contributor's server half runs (lib/module-gate.ts) and while the
 * contributor offers one for that link; `subscribeLinkActions` follows both.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { LinkAction, LinkRow } from "@prismshadow/penguin-web-plugin";
import { contributionShown, subscribeModuleGates } from "@prismshadow/penguin-web/internal";

interface Entry {
  action: LinkAction;
  /** The contributing module. */
  from: string;
}

let actions: readonly Entry[] = [];

/** The chat module's side: the contributed actions, in order. */
export function setLinkActions(next: readonly Entry[]): void {
  actions = next;
}

const warned = new Set<string>();

/**
 * The contributed rows for `href` right now, in order. Two rows reading the same would look like
 * one menu entry twice: the first keeps its place, a later one with the same label is dropped
 * (and said on the console, once).
 */
export function linkActionRows(href: string): readonly LinkRow[] {
  const rows: LinkRow[] = [];
  const labels = new Map<string, string>();
  for (const { action, from } of actions) {
    if (!contributionShown(from)) continue;
    const row = action.row(href);
    if (row === null) continue;
    const first = labels.get(row.label);
    if (first !== undefined) {
      const key = `${from}\0${row.label}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(
          `${from}: a link row reading "${row.label}" is already offered by ${first}; this one is dropped`,
        );
      }
      continue;
    }
    labels.set(row.label, from);
    rows.push(row);
  }
  return rows;
}

/** Fires when any contributor's offer, or any server-module gate, changes. */
export function subscribeLinkActions(listener: () => void): () => void {
  const stops = [
    subscribeModuleGates(listener),
    ...actions.map((a) => a.action.subscribe(listener)),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/** What the rows say, as a snapshot that stays equal while nothing a reader sees has changed. */
const rowsKey = (rows: readonly LinkRow[]): string =>
  rows.map((row) => `${row.glyph}\n${row.label}`).join("\n\n");

/** The contributed rows for `href`, re-read whenever a contributor's offer or a gate changes. */
export function useLinkActionRows(href: string): readonly LinkRow[] {
  const snapshot = () => rowsKey(linkActionRows(href));
  const key = useSyncExternalStore(subscribeLinkActions, snapshot, snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is what says the rows changed
  return useMemo(() => linkActionRows(href), [href, key]);
}

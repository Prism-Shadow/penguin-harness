/**
 * The PR graph page's view state: which part of the graph is drawn (the organization's own part,
 * or every PR with "Show other PRs", remembered per browser) and the in-graph search (the
 * `find.open` command — Ctrl+F, ⌘F on macOS; `graph.search` can be bound separately — its query, its hits and the current target).
 * The rules are pr-graph-search.ts's; this holds the state and the effects around them.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ProposalGraphResponse, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import {
  drawnRows,
  graphSearchCommand,
  readShowOthers,
  searchHits,
  segmentHolding,
  stepHit,
  writeShowOthers,
} from "./pr-graph-search";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface GraphView {
  /** The rows to draw now. */
  rows: ProposalGraphRow[];
  showOthers: boolean;
  setShowOthers: (on: boolean) => void;
  search: {
    open: boolean;
    query: string;
    setQuery: (q: string) => void;
    hits: string[];
    /** The current hit's position (0-based), -1 for none. */
    index: number;
    /** The node the search points at, while open. */
    target: string | null;
    step: (back: boolean) => void;
    close: () => void;
    inputRef: RefObject<HTMLInputElement | null>;
  };
}

/** `unfold` opens the folded segment a search target sits in. */
export function useGraphView(
  graph: ProposalGraphResponse | null,
  unfold: (segment: string) => void,
): GraphView {
  const [showOthers, setShowOthersState] = useState(() => readShowOthers(storage()));
  const setShowOthers = (on: boolean) => {
    setShowOthersState(on);
    writeShowOthers(storage(), on);
  };

  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hits = useMemo(
    () => (graph === null ? [] : searchHits(graph.rows, graph.nodes, query)),
    [graph, query],
  );
  const target = open && index >= 0 ? (hits[index] ?? null) : null;
  const rows = useMemo(
    () => (graph === null ? [] : drawnRows(graph, showOthers, target)),
    [graph, showOthers, target],
  );

  // Ctrl+F / ⌘F: open the box, or let the browser's find through when the box has focus.
  useEffect(() => {
    const handler = graphSearchCommand({
      focused: () => document.activeElement === inputRef.current,
      open: () => {
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      },
    });
    const offs = [onCommand("find.open", handler), onCommand("graph.search", handler)];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // The target's folded segment opens with it.
  useEffect(() => {
    if (graph === null || target === null) return;
    const segment = segmentHolding(rows, graph.nodes, target);
    if (segment !== null) unfold(segment);
  }, [graph, rows, target, unfold]);

  return {
    rows,
    showOthers,
    setShowOthers,
    search: {
      open,
      query,
      setQuery: (q) => {
        setQueryState(q);
        // The first hit is the target as soon as there is one, as a browser's find does.
        setIndex(0);
      },
      hits,
      index: hits.length === 0 ? -1 : Math.min(index, hits.length - 1),
      target,
      step: (back) => setIndex((i) => stepHit(Math.min(i, hits.length - 1), hits.length, back)),
      close: () => {
        setOpen(false);
        setQueryState("");
        setIndex(-1);
      },
      inputRef,
    },
  };
}

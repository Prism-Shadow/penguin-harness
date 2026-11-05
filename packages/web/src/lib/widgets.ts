/**
 * The web side of the widget slot: the `widgets` array of GET /api/contributions, read the
 * way the file renderer rules are (web-app/contributions.tsx) — each entry validated against
 * what this build can draw, the rest skipped. A widget renders an `iframe` (the plugin's own
 * `ui/` document, same-origin, the user's cookie carried), so a widget reads and writes its
 * state through the plugin state routes without this side knowing its shape.
 *
 * The validated widgets ride a small store of their own (one fetch, shared by every reader;
 * `refresh` after a plugin is installed or removed) instead of the page-table context — the
 * dock mounts outside the router and asks for nothing else the table holds. The dock itself
 * is part of the app layout (web-app/app-layout.tsx): one collapsed tile per widget, clicked
 * open into its frame.
 */
import { useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import * as api from "../api/endpoints";

/** One validated widget the dock can mount. */
export interface ContributedWidget {
  /** The contribution's server-side id. */
  id: string;
  /** The widget's key, unique among the validated widgets. */
  key: string;
  title?: string;
  titleZh?: string;
  size: "small" | "wide";
  /** `frame` puts the document in a titled card; `bare` draws it alone (see WebWidgetData). */
  chrome: "frame" | "bare";
  /** `iframe` with the document to frame; `builtin` resolved to a component by the caller. */
  renderer: { iframe: { src: string; namespace: string } } | { builtin: string };
}

const NO_WIDGETS: readonly ContributedWidget[] = [];

/**
 * The answer's widgets this build can draw, in the server's order: an entry needs a key and
 * a renderer; an iframe renderer needs a `src`; a `builtin` renderer is resolved against
 * `renderers` and dropped when the name is not in it. A key an earlier entry took is a skip
 * — first contributor wins, as pages do.
 */
export function widgetsOf(
  answer: unknown,
  renderers: ReadonlyMap<string, ComponentType> | null = null,
): readonly ContributedWidget[] {
  const entries = (answer as { widgets?: unknown } | null)?.widgets;
  if (!Array.isArray(entries)) return NO_WIDGETS;
  const out: ContributedWidget[] = [];
  const keys = new Set<string>();
  for (const entry of entries as Array<Record<string, unknown> | null>) {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
    if (typeof entry.key !== "string" || entry.key === "" || keys.has(entry.key)) continue;
    const renderer = rendererOf(entry.renderer, renderers);
    if (renderer === null) continue;
    keys.add(entry.key);
    out.push({
      id: entry.id,
      key: entry.key,
      ...(typeof entry.title === "string" ? { title: entry.title } : {}),
      ...(typeof entry.titleZh === "string" ? { titleZh: entry.titleZh } : {}),
      size: entry.size === "wide" ? "wide" : "small",
      chrome: entry.chrome === "bare" ? "bare" : "frame",
      renderer,
    });
  }
  return out;
}

function rendererOf(
  raw: unknown,
  renderers: ReadonlyMap<string, ComponentType> | null,
): ContributedWidget["renderer"] | null {
  const ref = raw as { iframe?: { src?: unknown; namespace?: unknown }; builtin?: unknown } | null;
  const iframe = ref?.iframe;
  if (typeof iframe?.src === "string" && iframe.src !== "") {
    return {
      iframe: {
        src: iframe.src,
        namespace: typeof iframe.namespace === "string" ? iframe.namespace : "",
      },
    };
  }
  if (typeof ref?.builtin === "string" && ref.builtin !== "") {
    // A builtin widget needs this build's registry to resolve it; a caller without a
    // registry (the tests) lets builtin names through and resolves them at mount.
    if (renderers === null || renderers.has(ref.builtin)) return { builtin: ref.builtin };
  }
  return null;
}

interface WidgetStore {
  /** The validated widgets as of the last answer; null until one arrives (or while signed out). */
  current(): readonly ContributedWidget[] | null;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

let store: WidgetStore | null = null;

/** The signed-in user's widgets, fetched once and shared; a failed or 401 answer reads empty. */
export function widgetStore(): WidgetStore {
  store ??= (() => {
    let widgets: readonly ContributedWidget[] | null = null;
    let asked = 0;
    const listeners = new Set<() => void>();
    const set = (next: readonly ContributedWidget[] | null) => {
      widgets = next;
      listeners.forEach((l) => l());
    };
    return {
      current: () => widgets,
      async refresh() {
        const mine = ++asked;
        try {
          const answer = await api.getContributions();
          if (mine === asked) set(widgetsOf(answer));
        } catch {
          // Signed out, offline, or an older server: no widgets this round, retry on refresh.
          if (mine === asked) set(NO_WIDGETS);
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  })();
  return store;
}

/** The validated widgets for the dock, live off the shared store. */
export function useContributedWidgets(
  renderers?: ReadonlyMap<string, ComponentType>,
): readonly ContributedWidget[] {
  const s = widgetStore();
  const widgets = useSyncExternalStore(
    s.subscribe,
    () => s.current(),
    () => null,
  );
  if (widgets === null) return NO_WIDGETS;
  // The store validated against no registry (it runs before the caller's is known); a
  // caller with one re-filters the builtin names it holds.
  if (renderers === undefined) return widgets;
  return widgets.filter(
    (w) => "iframe" in w.renderer || renderers.has(w.renderer.builtin),
  );
}

/**
 * The chat dock's UI workbench panel: point it at a running dev server, pick an element in the
 * page, and hand that element to the conversation with enough for the Agent to edit it without
 * searching — the file and line it was written on, its selector and computed style, and a
 * screenshot.
 *
 * The panel is the only place in the app that embeds someone else's site: the user's dev server is
 * a plain page whose DOM we read, never a document we author. It is therefore dev-only and
 * desktop-only by design, and it says both rather than degrading silently — a production build
 * carries neither the source maps nor the positions this feature locates elements with, and a
 * browser tab has no guest element to read a page through.
 *
 * What is here now is the address, the guest, the picker and the payload: the address row remembers
 * where you pointed it, the probe offers the dev servers it found instead of making you guess a
 * port, the status line names what went wrong in the terms that suggest the next move (nothing on
 * the port, a timeout, a page that will not be read) instead of calling every failure a connection
 * error, picking highlights what is under the cursor inside the user's page, locks the highlight on
 * a click while that click is stopped from reaching the page, and stands down on `暂离` for the
 * elements that are only reachable by using the page first.
 *
 * A picked element becomes the frozen v1 payload (§6) right here: `element-payload.ts` assembles it
 * from the element's facts, the page it was found on, and the Session's workspace — which is the
 * project being previewed, and the only thing that makes a relative source path unambiguous. The
 * panel shows that payload back, field by field and then as JSON, because the whole promise of this
 * feature is that the user can see exactly what the Agent is about to be told, and `加入对话` stages
 * it in the composer: a chip naming the element, and the payload itself in the message when it is
 * sent. The source half is resolved from the page's own framework evidence (`source-resolution.ts`),
 * and when it cannot be, the card says which of the four tiers it landed in and why
 * (`source-tier.ts`) instead of only saying that it has nothing — a page with no readable source map
 * is a documented limit of this feature (PRD FR-07), not a bug in it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toneStrip } from "../../lib/tone";
import type { ComposerReference } from "../../lib/workspace-tree";
import { inspectPage, probeCandidatePorts } from "./dev-server-probe";
import type { PageInspection, PortProbe } from "./dev-server-probe";
import { createGuest, destroyGuest, desktopShell, guestReady } from "./preview-guest";
import type {
  GuestConsoleEvent,
  GuestElement,
  GuestFailEvent,
  GuestNavigateEvent,
} from "./preview-guest";
import {
  describeTarget,
  elementFromGuest,
  parsePickerMessage,
  pickerCommand,
  pickerFrameCount,
  pickerResolve,
  pickerScript,
} from "./element-picker";
import type { ElementFacts } from "./element-picker";
import { boundsNotes } from "./element-bounds";
import type { BoundsNote } from "./element-bounds";
import { buildPayload, elementLabel, elementReferenceText } from "./element-payload";
import type { ElementPayload, PayloadSource } from "./element-payload";
import { registerElementSource } from "./element-references";
import type { ElementGoneReason, ElementRefresh } from "./element-references";
import { createModuleReader, resolveSource } from "./source-resolution";
import { explainSourceGap, sourceRowText } from "./source-tier";
import type { SourceGapReason } from "./source-tier";
import {
  ADDRESS_KEY,
  initialAddress,
  normalizeAddress,
  pickMode,
  reduceGuest,
  reducePick,
  selectionIdentity,
  sourceFor,
  NO_PICK,
  type GuestState,
  type LoadFailure,
  type PickEvent,
  type PickMode,
  type PickState,
  type ResolvedSource,
} from "./workbench-state";

function readStoredAddress(): string | null {
  try {
    return localStorage.getItem(ADDRESS_KEY);
  } catch {
    return null;
  }
}

function rememberAddress(url: string): void {
  try {
    localStorage.setItem(ADDRESS_KEY, url);
  } catch {
    // A refused write (private mode, quota) costs the user a retyped address, nothing more.
  }
}

function failureText(failure: LoadFailure, code: number, description: string): string {
  const named: Record<LoadFailure, string> = {
    refused: S.workbench.failure.refused,
    timeout: S.workbench.failure.timeout,
    dns: S.workbench.failure.dns,
    blocked: S.workbench.failure.blocked,
    "http-error": S.workbench.failure.httpError,
    crashed: S.workbench.failure.crashed,
    aborted: S.workbench.failure.aborted,
    other: S.workbench.failure.other,
  };
  const detail = code === 0 ? description : `${description || "?"} ${code}`;
  return `${named[failure]} · ${detail}`;
}

/** What the page on the other end can be expected to give us, said plainly. */
function tierText(result: PageInspection): string {
  if (result.sourceMap === "present") return S.workbench.tierPrecise;
  if (result.sourceMap === "none") return S.workbench.tierDegraded;
  return result.kind === "listening" ? S.workbench.tierOpaque : S.workbench.tierUnknown;
}

/**
 * The origin of an address, for asking whether two of them are the same document host. A path is not
 * part of the answer: a route change inside the page is the same page, and a chip stays true across
 * one. An unparseable address has no origin, which compares equal only to itself.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function probeSuffix(probe: PortProbe): string {
  if (probe.kind === "vite") return "Vite";
  return probe.kind === "page" ? S.workbench.probeWeb : S.workbench.probeOpaque;
}

/** The payload as the card reads it: one line per fact, in the order a person checks them. */
function payloadRows(
  payload: ElementPayload,
  sourceValue: string,
): { label: string; value: string }[] {
  const t = S.workbench.payload;
  const rows = [
    { label: t.refId, value: payload.target.refId },
    { label: t.selector, value: payload.target.cssSelector },
    { label: t.tag, value: payload.target.tagName },
    { label: t.role, value: payload.target.role ?? "—" },
    { label: t.name, value: payload.target.name ?? "—" },
    { label: t.text, value: payload.target.text === "" ? "—" : payload.target.text },
  ];
  if (payload.target.testId !== null) rows.push({ label: t.testId, value: payload.target.testId });
  rows.push(
    {
      label: t.rect,
      value: `${payload.target.rect.x},${payload.target.rect.y} · ${payload.target.rect.w}×${payload.target.rect.h}`,
    },
    {
      label: t.parentChain,
      value: payload.target.parentChain.length === 0 ? "—" : payload.target.parentChain.join(" ← "),
    },
    {
      label: t.classes,
      value: payload.style.classes.length === 0 ? "—" : payload.style.classes.join(" "),
    },
    { label: t.project, value: payload.page.projectRoot },
    {
      label: t.page,
      value: `${payload.page.url} · ${payload.page.viewport.width}×${payload.page.viewport.height}@${payload.page.viewport.dpr}x`,
    },
    { label: t.source, value: sourceValue },
  );
  return rows;
}

export function WorkbenchPanel({
  workspace,
  onAddReference,
}: {
  /** The Session's workspace: the project being previewed, which is what the payload's root names. */
  workspace: string;
  /**
   * Stage the picked element in the composer. The panel builds the reference itself — the label the
   * chip wears, the `refId` that makes staging it twice an update, and the message text — because
   * everything it needs is here; the chat page only has to hand the chip to whoever is listening.
   */
  onAddReference: (reference: ComposerReference) => void;
}) {
  const inShell = desktopShell();
  const [draft, setDraft] = useState(() => initialAddress(readStoredAddress()));
  /** The address the guest is actually pointed at; null until the first load. */
  const [target, setTarget] = useState<string | null>(null);
  const [guestState, setGuestState] = useState<GuestState>({ kind: "idle" });
  const [inspection, setInspection] = useState<PageInspection | null>(null);
  const [probes, setProbes] = useState<PortProbe[] | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const guestRef = useRef<GuestElement | null>(null);
  const [pick, setPick] = useState<PickState>(NO_PICK);
  /**
   * The same state, readable from the guest's own event handlers: those are installed once per
   * address, and re-creating them on every hover would recreate the guest.
   */
  const pickRef = useRef<PickState>(NO_PICK);
  const mode = pickMode(pick);
  /**
   * The source half of the payload, resolved from the page's own framework evidence. It is state
   * rather than part of the memo below because resolving it is asynchronous: it fetches the module
   * the element was compiled from and reads the source map inside it (M3).
   *
   * It is stored *tagged* with the selection it answers for (M5.1), because the pick and the answer
   * do not change state in the same tick: untagged, the frame between a new pick and its resolution
   * showed the new element beside the previous element's file and line — which the probe caught both
   * in the DOM and in a `rAF`, so it was drawn, not merely held (see `sourceFor`).
   */
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource<PayloadSource> | null>(null);
  /** The module URLs the page loaded — the fallback when a framework names no module at all. */
  const moduleUrlsRef = useRef<string[]>([]);
  /**
   * What was staged into the composer, by `refId`: the payload the chip carries, and the label it
   * wears. This is the other half a send-time re-resolution needs — the path and the anchor to look
   * the element up by — and the name to report it under when it is not found (M4.1).
   */
  const stagedPayloads = useRef<Map<string, { payload: ElementPayload; label: string }>>(new Map());
  /**
   * Elements a send-time re-resolution could not find. The panel is where that gets said out loud —
   * the composer marks the chip and holds the message, and this is the line that explains why.
   */
  const [goneElements, setGoneElements] = useState<{ label: string; reason: ElementGoneReason }[]>(
    [],
  );
  /**
   * Frames the loaded page embeds (M4.4, PRD §9.4). Nothing inside one can be picked, and the panel
   * only knows to say so because the page counted them; `null` while nobody has asked.
   */
  const [frameCount, setFrameCount] = useState<number | null>(null);

  /**
   * Ask the page which modules it loaded. Cheap, read-only, and the only thing the React 18 route
   * needs when `_debugSource` is absent: a component's compiled text is distinctive enough to find
   * the module it came from by searching these.
   */
  const collectModuleUrls = useCallback(async () => {
    const guest = guestRef.current;
    if (guest === null) return;
    try {
      const urls = await guest.executeJavaScript(
        'performance.getEntriesByType("resource").map(function (e) { return e.name; })',
      );
      moduleUrlsRef.current = Array.isArray(urls) ? urls.filter((u) => typeof u === "string") : [];
    } catch {
      // A guest that went away mid-call: the next document collects its own list.
    }
  }, []);

  /**
   * Which selection the source state is being asked about, and the source that is true of it.
   *
   * The pair is what keeps a card from ever naming the wrong file: a resolution that answers an
   * earlier pick is simply not this selection's, so the row reads as `pending` until the one that is
   * arrives. Nothing here depends on the pick and the resolution landing in the same render, which is
   * the property the untagged version did not have (M5.1, `实测脚本/m54-卡片归属/`).
   */
  const sourceIdentity =
    pick.selected === null || pick.page === null
      ? null
      : selectionIdentity(pick.page.url, pick.selected.cssSelector);
  const source = sourceFor(resolvedSource, sourceIdentity);

  /**
   * The payload for the current selection, built from the facts the page reported rather than
   * cached: a new pick is a new payload, and `projectRoot` (the Session's workspace) can change
   * under a panel that is deliberately not keyed by Session — switching conversations must not keep
   * pointing the next payload at the previous project.
   */
  const payload = useMemo(
    () =>
      pick.selected === null || pick.page === null
        ? null
        : buildPayload({
            target: pick.selected,
            page: pick.page,
            projectRoot: workspace,
            ...(source === null ? {} : { source }),
          }),
    [pick.selected, pick.page, workspace, source],
  );

  /**
   * What the source row says, and why. `pending` is exactly "the pick is in and the resolution has
   * not answered yet": `source` is null from the moment a selection arrives until `resolveSource`
   * returns, so nothing false is shown in the gap. The reason is derived from facts the panel already
   * has — the payload's own confidence, whether the framework reported any evidence, and what the
   * address probe read off the page — rather than from a new field in the frozen payload schema
   * (D20: §6 is not widened for a panel sentence).
   */
  const sourcePending = pick.selected !== null && source === null;
  const sourceGap = explainSourceGap({
    source: source ?? { confidence: "none" },
    hasEvidence: pick.selected?.origin != null,
    pageSourceMap: inspection?.sourceMap ?? "unknown",
  });

  /**
   * Resolve where the selected element is written, as soon as the page reports a pick. The page hands
   * over its framework's own evidence (`origin`), and this reads the module that evidence names and
   * maps the generated position back to a source location. It is deliberately *not* awaited by the
   * card: the DOM half of the payload is readable immediately, and the source row fills in when — and
   * if — the location resolves. An element with no evidence at all stays `none`, which is what an
   * element in a production build is.
   *
   * The module text is read **fresh** for every pick, and that is a correction rather than a
   * preference (M4.1, measured in `实测脚本/m41-回指刷新验收/`): the reader used to cache by URL, which
   * is exactly the wrong key here. A dev server serves a module's *current* text at the same URL, so
   * after the user saved a file the cached copy was the pre-save answer — the card then showed the
   * line the element no longer was on, while the element on screen had moved. The one thing the panel
   * must never do is show a location as a fact when the file has moved on; a re-fetch on localhost is
   * the cheaper side of that trade.
   */
  useEffect(() => {
    const selected = pick.selected;
    if (selected === null || pick.page === null) {
      setResolvedSource(null);
      return;
    }
    const identity = selectionIdentity(pick.page.url, selected.cssSelector);
    let cancelled = false;
    // Clearing is about `pending`, not about safety: the tag already keeps this answer from being
    // shown for another selection. It goes away with the pick so the row reads as "resolving" rather
    // than as the previous answer for the *same* element, which may have moved on disk since (M4.1).
    setResolvedSource(null);
    void resolveSource(selected.origin ?? null, {
      pageUrl: pick.page.url,
      projectRoot: workspace,
      fetchText: createModuleReader(),
      moduleUrls: moduleUrlsRef.current,
    })
      .then((resolved) => {
        if (!cancelled) setResolvedSource({ identity, source: resolved });
      })
      .catch(() => {
        // `resolveSource` reports its own failures as `none`; this is for the unexpected one, and it
        // must not leave the previous element's location on screen.
        if (!cancelled) setResolvedSource({ identity, source: { confidence: "none" } });
      });
    return () => {
      cancelled = true;
    };
  }, [pick.selected, pick.page, workspace]);

  /**
   * The chip a payload becomes: the name a person reads, the `refId` that says which element it is,
   * and the message body the Agent receives. One function for the two moments a chip is made — staged
   * by hand, and refreshed at send time — so the two can never disagree about what a chip carries.
   */
  const referenceOf = useCallback(
    (target: ElementFacts, built: ElementPayload): ComposerReference => {
      const label = elementLabel(target);
      // The one fact the payload (§6 v1, frozen) has no field for, said in the prose instead: an
      // element the picker could not reach into is a host or a frame, not the thing under the cursor
      // (M4.4). An Agent reading only the JSON would style the host and wonder why nothing moved.
      const note =
        target.domContext === undefined
          ? undefined
          : S.workbench.domContextMessage[target.domContext];
      return {
        kind: "element",
        label,
        refId: built.target.refId,
        text: elementReferenceText(S.workbench.elementLead(label, built.page.url, note), built),
      };
    },
    [],
  );

  /**
   * Hand the payload to the conversation: a chip in the composer, and — on send — the payload as a
   * fenced JSON block behind a line of prose. Nothing is sent and the draft is untouched: what the
   * workbench contributes is a thing the message is about, not words in the user's sentence.
   *
   * The payload is also *kept*, by `refId`: at send time the composer asks this panel to re-resolve
   * every element chip, and this is what it answers from (M4.1).
   */
  const addToConversation = useCallback(() => {
    const target = pick.selected;
    if (payload === null || target === null) return;
    const reference = referenceOf(target, payload);
    stagedPayloads.current.set(payload.target.refId, {
      payload,
      label: reference.label ?? payload.target.refId,
    });
    setGoneElements([]);
    onAddReference(reference);
  }, [payload, pick.selected, onAddReference, referenceOf]);

  /**
   * Re-read one staged element from the page as it is now (M4.1 / AC-8).
   *
   * The composer calls this for every element chip immediately before a message is composed, so what
   * the message carries is the page's current answer rather than the snapshot taken when the chip was
   * staged: a line that moved with the user's last save, a style the edit changed, an id issued from
   * the new site. Three honest ways out, and no fourth:
   *
   * - **refreshed** — the element is there (same tag, same `data-testid` when it had one), and here it
   *   is, as of now. `moved` says the source site is not the one the chip was staged with.
   * - **gone** — the page does not have it (`missing`), something else is at that path (`replaced`),
   *   or the preview is on another page altogether (`page-changed`, AC-11c). Reported, and the send
   *   is held: a payload the page has already contradicted is exactly the stale data R6 is about.
   * - **unknown** — we cannot check at all (no page loaded, no picker in it, or a guest that went away
   *   mid-call). The chip keeps its snapshot, and nothing claims to have verified it.
   */
  const refreshStaged = useCallback(
    async (refId: string): Promise<ElementRefresh> => {
      const staged = stagedPayloads.current.get(refId);
      const guest = guestRef.current;
      if (staged === undefined || guest === null || target === null || !pickRef.current.live) {
        return { kind: "unknown" };
      }
      const reportGone = (reason: ElementGoneReason): ElementRefresh => {
        setGoneElements((previous) =>
          previous.some((entry) => entry.label === staged.label && entry.reason === reason)
            ? previous
            : [
                ...previous.filter((entry) => entry.label !== staged.label),
                { label: staged.label, reason },
              ],
        );
        return { kind: "gone", reason };
      };
      const payload = staged.payload;
      // The chip names a page; if the panel has been pointed somewhere else since, the chip is about a
      // document that is no longer on screen — and looking for its element in the new one is precisely
      // the mistake AC-11c names.
      if (originOf(payload.page.url) !== originOf(target)) return reportGone("page-changed");
      let answer: unknown = null;
      try {
        answer = await guest.executeJavaScript(
          pickerResolve(payload.target.cssSelector, payload.target.testId),
        );
      } catch {
        return { kind: "unknown" };
      }
      const found = elementFromGuest(answer);
      if (found === null) return reportGone("missing");
      // The path still matches something, but a same-shaped node is not the same element: the tag
      // (and, inside the picker, the testid) is what keeps "it moved" from being reported as "it is
      // still there" when the page was rewritten underneath the chip.
      if (found.target.tagName !== payload.target.tagName) return reportGone("replaced");
      const source = await resolveSource(found.target.origin ?? null, {
        pageUrl: found.page.url,
        projectRoot: workspace,
        // A **fresh** reader on purpose: the module this element was compiled from is the file the
        // user just saved, and the cached copy of it is the stale answer this path exists to avoid.
        fetchText: createModuleReader(),
        moduleUrls: moduleUrlsRef.current,
      });
      const built = buildPayload({
        target: found.target,
        page: found.page,
        projectRoot: workspace,
        source,
      });
      const reference = referenceOf(found.target, built);
      // Re-keyed rather than updated in place: the id is derived from the site, so an element that
      // moved *has* a new one, and the old key would otherwise linger for every edit of the session.
      stagedPayloads.current.delete(refId);
      stagedPayloads.current.set(built.target.refId, {
        payload: built,
        label: reference.label ?? refId,
      });
      setGoneElements((previous) => previous.filter((entry) => entry.label !== reference.label));
      const moved =
        payload.source.file !== built.source.file ||
        payload.source.line !== built.source.line ||
        payload.source.column !== built.source.column;
      return { kind: "refreshed", reference, moved };
    },
    [target, workspace, referenceOf],
  );

  // The composer asks this panel — the only thing in the app that owns a guest — before it sends.
  // Registered once per mount, through a ref so the registration does not churn with every pick.
  const refreshRef = useRef(refreshStaged);
  refreshRef.current = refreshStaged;
  useEffect(() => registerElementSource({ refresh: (refId) => refreshRef.current(refId) }), []);

  /** Ask the page's picker to match the mode the panel is in. `missing` when there is no picker yet. */
  const applyGuestMode = useCallback(async (next: PickMode) => {
    const guest = guestRef.current;
    if (guest === null) return;
    try {
      await guest.executeJavaScript(pickerCommand(next));
    } catch {
      // The guest can go away between a click and this call — a reload, a closed panel. The next
      // dom-ready installs the picker again and applies whatever the mode is by then.
    }
  }, []);

  /**
   * The panel's one way to change picker state. The reducer decides, the ref makes the decision
   * readable from the guest's handlers, and only a *change of mode* is forwarded to the page: hover
   * and selection events came from there in the first place, and echoing them back would be a loop.
   */
  const dispatchPick = useCallback(
    (event: PickEvent) => {
      const previous = pickRef.current;
      const next = reducePick(previous, event);
      pickRef.current = next;
      setPick(next);
      const before = pickMode(previous);
      const after = pickMode(next);
      if (after !== before) void applyGuestMode(after);
    },
    [applyGuestMode],
  );

  /**
   * Esc in the panel itself. The page's Esc arrives over the console channel instead — whichever of
   * the two has focus sees the key, never both.
   */
  useEffect(() => {
    if (mode === "off") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      dispatchPick({ kind: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dispatchPick]);

  /**
   * How many frames the page embeds, asked while the user is picking (M4.4, PRD §9.4).
   *
   * A frame's interior is another document, and nothing about the page on screen says so — the user
   * would just find that the card they want cannot be picked. The question is answered by the page
   * itself, re-asked whenever the document changes, and cleared the moment picking stops: a count
   * belongs to the document it was measured on.
   */
  useEffect(() => {
    if (mode !== "picking" || guestState.kind !== "ready") {
      setFrameCount(null);
      return;
    }
    const guest = guestRef.current;
    if (guest === null) return;
    let cancelled = false;
    void guest
      .executeJavaScript(pickerFrameCount())
      .then((value) => {
        if (!cancelled) setFrameCount(typeof value === "number" && value >= 0 ? value : null);
      })
      .catch(() => {
        // A guest that went away mid-call: the next document counts its own frames.
        if (!cancelled) setFrameCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, guestState]);

  // Find the dev servers before asking the user to type a port. The ports are on this machine
  // either way, so this runs in a browser tab too — that is where it is most useful, since a
  // browser tab cannot preview anything and the answer is still worth knowing.
  useEffect(() => {
    let cancelled = false;
    void probeCandidatePorts().then((found) => {
      if (!cancelled) setProbes(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback((raw: string) => {
    const url = normalizeAddress(raw);
    if (url === null) {
      setGuestState((state) =>
        reduceGuest(state, {
          kind: "failed",
          code: 0,
          description: S.workbench.badAddress,
        }),
      );
      return;
    }
    setDraft(url);
    rememberAddress(url);
    setTarget(url);
    setInspection(null);
    void inspectPage(url).then((result) => setInspection(result));
  }, []);

  // One guest per address. A new address is a new page, and everything derived from the old one —
  // including any element picked out of it — stops being true at that moment, not later.
  useEffect(() => {
    const container = containerRef.current;
    if (!inShell || target === null || container === null) return;
    const guest = createGuest(container, target);
    guestRef.current = guest;
    setGuestState((state) => reduceGuest(state, { kind: "navigating", url: target }));

    // Every signal below goes through `reduceGuest`: the order Electron delivers them in is not the
    // order of their meaning (a failed load still raises `dom-ready` for its error page), and that
    // rule is a tested one rather than a property of this effect's listener bodies.
    const onStarted = (event: Event) => {
      const { isMainFrame, url } = event as GuestNavigateEvent;
      if (isMainFrame === false) return;
      setGuestState((state) => reduceGuest(state, { kind: "navigating", url: url || target }));
    };
    const onReady = () => {
      setGuestState((state) =>
        reduceGuest(state, { kind: "ready", url: guest.getURL() || target }),
      );
      // The picker lives in the page's own JavaScript context, so it is gone after every navigation
      // (a Vite full reload included) and has to be put back. Installing and then applying the current
      // mode is one sequence on purpose: an installed picker that never got started would swallow
      // clicks without ever highlighting anything.
      void guest
        .executeJavaScript(pickerScript())
        .then((result) => {
          if (result !== "installed") return;
          dispatchPick({ kind: "installed" });
          void collectModuleUrls();
          return applyGuestMode(pickMode(pickRef.current));
        })
        .catch(() => {
          // A guest that went away while we were talking to it: the next one installs its own picker.
        });
    };
    const onFailed = (event: Event) => {
      const { errorCode, errorDescription, isMainFrame } = event as GuestFailEvent;
      if (isMainFrame === false) return;
      setGuestState((state) =>
        reduceGuest(state, { kind: "failed", code: errorCode, description: errorDescription }),
      );
    };
    // The page's console is a shared channel: the picker reports over it (the one channel M1/E4a
    // measured to work without a host preload), and everything without our prefix is the page's own
    // logging — never mistaken for ours.
    const onConsole = (event: Event) => {
      const { message } = event as GuestConsoleEvent;
      const parsed = parsePickerMessage(typeof message === "string" ? message : "");
      if (parsed === null) return;
      switch (parsed.kind) {
        case "hover":
          dispatchPick({ kind: "hover", target: parsed.target, page: parsed.page });
          return;
        case "selected":
          dispatchPick({ kind: "selected", target: parsed.target, page: parsed.page });
          return;
        case "cleared":
          dispatchPick({ kind: "cleared" });
          return;
        case "exited":
          dispatchPick({ kind: "exited" });
          return;
        default:
          // installed / active / paused / stopped are the picker acknowledging a command we sent; the
          // panel already knows, and reacting again would fight the user's switch.
          return;
      }
    };
    guest.addEventListener("did-start-navigation", onStarted);
    guest.addEventListener("dom-ready", onReady);
    guest.addEventListener("did-fail-load", onFailed);
    guest.addEventListener("console-message", onConsole);

    // Electron installs the guest's API when the element enters the document, so the check is a
    // frame late on purpose: asking synchronously reports "no such API" on a shell that works.
    const raf = requestAnimationFrame(() => {
      if (!guestReady(guest)) setGuestState((state) => reduceGuest(state, { kind: "unsupported" }));
    });

    return () => {
      cancelAnimationFrame(raf);
      guest.removeEventListener("did-start-navigation", onStarted);
      guest.removeEventListener("dom-ready", onReady);
      guest.removeEventListener("did-fail-load", onFailed);
      guest.removeEventListener("console-message", onConsole);
      destroyGuest(guest);
      guestRef.current = null;
      // Nothing is being picked any more — and what was selected belonged to the page that just went
      // away, so it is not carried over (the switch itself is: see `reducePick`).
      dispatchPick({ kind: "guest-gone" });
    };
  }, [inShell, target, dispatchPick, applyGuestMode]);

  if (!inShell) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {S.workbench.desktopOnly}
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {S.workbench.desktopOnlyDetail}
        </p>
        {probes !== null && probes.length > 0 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {S.workbench.foundPorts}{" "}
            {probes.map((probe) => `${probe.port}（${probeSuffix(probe)}）`).join("、")}
          </p>
        )}
      </div>
    );
  }

  const status = (() => {
    switch (guestState.kind) {
      case "unsupported-guest":
        return <p className={strip("danger")}>{S.workbench.guestUnavailable}</p>;
      case "loading":
        return <p className={strip("busy")}>{S.workbench.loading}</p>;
      case "ready":
        return (
          <p className={strip("success")}>
            {S.workbench.connected} · {guestState.url}
            {inspection !== null && <> · {tierText(inspection)}</>}
          </p>
        );
      case "failed":
        return (
          <p className={strip("danger")}>
            {failureText(guestState.failure, guestState.code, guestState.description)}
          </p>
        );
      case "idle":
        // Nothing found and nothing loaded yet: the first thing to say is where to get a server.
        return probes !== null && probes.length === 0 ? (
          <p className={strip("attention")}>{S.workbench.noDevServer}</p>
        ) : null;
    }
  })();

  /**
   * §9.4's matrix applied to what is on screen (M4.4): the two structures the picker cannot reach
   * into, an element that cannot be seen, and the frames the page embeds. Reasons here, sentences
   * below — the copy is bilingual and lives in the strings tables.
   */
  const bounds = boundsNotes({
    target: pick.selected,
    picking: mode === "picking",
    frameCount,
  });
  const boundsHost = pick.selected === null ? "" : describeTarget(pick.selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
        <Input
          size="sm"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-label={S.workbench.addressLabel}
          placeholder={S.workbench.addressPlaceholder}
          className="min-w-0 flex-1 font-mono"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(draft);
          }}
        />
        <Button size="sm" variant="primary" onClick={() => load(draft)}>
          {S.workbench.load}
        </Button>
        {target !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              guestRef.current?.reload();
              if (target !== null) {
                setGuestState((state) => reduceGuest(state, { kind: "navigating", url: target }));
              }
            }}
          >
            {S.workbench.reload}
          </Button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
        <span className="mr-1 text-xs text-gray-400">{S.workbench.foundPorts}</span>
        {probes === null ? (
          <span className="text-xs text-gray-400">{S.workbench.probing}</span>
        ) : probes.length === 0 ? (
          <span className="text-xs text-gray-400">{S.workbench.noneFound}</span>
        ) : (
          probes.map((probe) => (
            <button
              key={probe.port}
              type="button"
              title={probe.title ?? probe.url}
              onClick={() => load(probe.url)}
              className="rounded-md border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60"
            >
              {probe.port}
              <span className="ml-1 font-sans text-gray-400">{probeSuffix(probe)}</span>
            </button>
          ))
        )}
      </div>

      {status}

      {/* The picker's own row: the switch, `暂离`, and what is under the cursor. It is here rather
          than over the page because the page belongs to the user — the overlay in there is only the
          highlight box, which never intercepts anything. */}
      {guestState.kind === "ready" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
          <Button
            size="sm"
            variant={mode === "off" ? "primary" : "ghost"}
            onClick={() => dispatchPick({ kind: "toggle" })}
          >
            {mode === "off" ? S.workbench.pickStart : S.workbench.pickStop}
          </Button>
          {mode === "paused" ? (
            <Button size="sm" variant="primary" onClick={() => dispatchPick({ kind: "resume" })}>
              {S.workbench.pickResume}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={mode === "off"}
              onClick={() => dispatchPick({ kind: "pause" })}
            >
              {S.workbench.pickPause}
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {pick.selected !== null
              ? `${S.workbench.picked} ${describeTarget(pick.selected)}`
              : pick.hovered !== null && mode === "picking"
                ? `${S.workbench.candidate} ${describeTarget(pick.hovered)}`
                : ""}
          </span>
        </div>
      )}

      {/* §9.4's bounds, said where they bite (M4.4): the structures the picker cannot enter, an element
          that cannot be seen, and the frames the page embeds. §2.3 requires saying it rather than
          quietly handing over a neighbour — so it sits above the payload, which is what it qualifies. */}
      {bounds.length > 0 && (
        <div
          data-workbench-bounds="1"
          className={`shrink-0 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800 ${strip("attention")}`}
        >
          <ul className="space-y-0.5 text-xs">
            {bounds.map((note) => (
              <li key={boundsKey(note)}>{boundsText(note, boundsHost)}</li>
            ))}
          </ul>
          {bounds.some((note) => note.kind === "not-visible") && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.workbench.notVisibleDetail}
            </p>
          )}
        </div>
      )}

      {/* What a send-time re-resolution found (AC-8): an element the page no longer has, said here as
          well as on the chip, because this panel is the thing that asked the page the question. */}
      {goneElements.length > 0 && (
        <div
          className={`shrink-0 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800 ${strip("attention")}`}
        >
          <p className="text-xs">
            {goneElements
              .map((entry) => S.workbench.goneElement(entry.label, entry.reason))
              .join(" ")}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {S.workbench.goneElementDetail}
          </p>
        </div>
      )}

      {/* The payload, as it will be handed to the Agent. It sits under the picker row because that is
          what it describes, and it is shown in full — the point of the feature is that nothing goes
          into the conversation that the user could not have read first. */}
      {payload !== null && (
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 px-3 pt-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-600 dark:text-gray-300">
              {S.workbench.payload.title}
            </span>
            <Button size="sm" variant="primary" onClick={addToConversation}>
              {S.workbench.addToChat}
            </Button>
          </div>
          <div className="max-h-32 overflow-y-auto px-3 py-1">
            {payloadRows(
              payload,
              sourceRowText(payload.source, { pending: sourcePending, gap: sourceGap }),
            ).map((row) => (
              <div key={row.label} className="flex gap-2 text-xs leading-5">
                <span className="w-14 shrink-0 text-gray-400">{row.label}</span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-gray-600 dark:text-gray-300"
                  title={row.value}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          {/* Collapsed on purpose: measured in the m25 acceptance, a payload block with the JSON
              expanded left the preview pane 91px tall (from 526px) — an inspector that eats the
              thing it inspects. The facts above are the same data in the form you can read at a
              glance; the JSON is one click away for when you want it verbatim. */}
          <details className="px-3 pb-2">
            <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
              {S.workbench.payload.json}
            </summary>
            <pre
              data-workbench-payload="1"
              className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-[11px] leading-4 text-gray-600 dark:bg-gray-900 dark:text-gray-300"
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* §9.4's support matrix (5.4), as a fold — not a "?" (the frontend rule: a circled question
          mark may only sit beside a title, and this has none). It is shown exactly while no page is
          loaded, which is when the question it answers ("can this work on my project at all") is
          asked; once a page is up the tier line above says that page's own answer instead, and the
          preview keeps its height (the m25 pitfall: an expanded block left the preview 91px tall).
          Under the matrix sit the four limits a location comes with (5.4, D30) — the JSX-not-CSS
          distinction, the stylesheet short-circuit, the wrapping element behind `ambiguous`, and the
          unauthenticated return channel — because they are read at the same moment, before the panel
          is trusted with anything. */}
      {guestState.kind !== "ready" && (
        <details
          data-workbench-support="1"
          className="shrink-0 border-b border-gray-200 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
        >
          <summary className="cursor-pointer">{S.workbench.support.title}</summary>
          <p className="mt-1">{S.workbench.support.line}</p>
          <ul className="mt-1 space-y-0.5">
            <li>{S.workbench.support.exact}</li>
            <li>{S.workbench.support.fileOnly}</li>
            <li>{S.workbench.support.degraded}</li>
            <li>{S.workbench.support.unreachable}</li>
            <li>{S.workbench.support.thirdParty}</li>
          </ul>
          <p className="mt-1">{S.workbench.support.boundaries.lead}</p>
          <ul className="mt-0.5 space-y-0.5">
            <li>{S.workbench.support.boundaries.rows.jsx}</li>
            <li>{S.workbench.support.boundaries.rows.styles}</li>
            <li>{S.workbench.support.boundaries.rows.ambiguous}</li>
            <li>{S.workbench.support.boundaries.rows.channel}</li>
          </ul>
        </details>
      )}

      <div ref={containerRef} className="min-h-0 flex-1 bg-white dark:bg-gray-950" />

      {guestState.kind === "ready" && (
        <p className={strip("muted")}>
          {pick.selected !== null
            ? S.workbench.pickedNext
            : mode === "paused"
              ? S.workbench.pausedHint
              : mode === "off"
                ? S.workbench.pickOffHint
                : S.workbench.pickHint}
        </p>
      )}
    </div>
  );

  /** A status strip: one line, its own colour, never a bare line of body text. */
  function strip(tone: "busy" | "attention" | "success" | "danger" | "muted"): string {
    return `shrink-0 px-3 py-1.5 text-xs ${toneStrip[tone]}`;
  }
}

/** One §9.4 note as a sentence; `host` names the element when the note is about one (M4.4). */
function boundsText(note: BoundsNote, host: string): string {
  switch (note.kind) {
    case "shadow":
      return S.workbench.domContext.shadow(host);
    case "frame":
      return S.workbench.domContext.frame;
    case "not-visible":
      return S.workbench.notVisible[note.reason];
    case "frames-in-page":
      return S.workbench.framesInPage(note.count);
  }
}

/** A stable key for the list above: the kind, plus the reason when there is one. */
function boundsKey(note: BoundsNote): string {
  return note.kind === "not-visible" ? `${note.kind}:${note.reason}` : note.kind;
}

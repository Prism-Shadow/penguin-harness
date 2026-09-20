/**
 * A Browser tab — a page in the dock.
 *
 * WHAT IT OPENS. `localhost:3000` here means port 3000 of the machine the conversation's
 * Workspace is on: the dev server the agent just started, wherever it is running. Any other
 * address is the public internet's. The server decides both (POST /api/browser/sites) and
 * refuses the rest.
 *
 * WHERE IT RUNS. Never on the app's origin. The server gives each site a host of its own,
 * `<label>.localhost`, and the frame loads THAT: the app's session cookie is scoped to the
 * app's host and is not sent there, the page's scripts cannot reach this window's document,
 * and the frame's sandbox withholds top-level navigation — a page cannot replace the app
 * with a copy of its sign-in screen.
 *
 * WHAT IT IS TOLD. The app's appearance (browser-theme.ts), on load and whenever it changes.
 * The page tells back where it is, so the address bar follows its own links, and hands over
 * a link that leaves its site, which opens as a site of its own. Messages are taken only from
 * this tab's frame, on this tab's host.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { openBrowserSite } from "../../api/endpoints";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import {
  ARROW_LEFT_ICON,
  ARROW_RIGHT_ICON,
  EXTERNAL_LINK_ICON,
  REFRESH_ICON,
} from "../../components/ui/icons";
import { EmptyState } from "../../components/ui/empty-state";
import { noAutofill } from "../../components/ui/input";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { readDocumentTheme } from "../../lib/workflow-theme";
import { useTheme } from "../../state/theme";
import { browserAddress, setBrowserAddress } from "./browser-tabs";
import { browserThemeMessage } from "./browser-theme";

const BAR_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/**
 * No `allow-top-navigation`: the page may not navigate the app away. `allow-same-origin` is
 * safe BECAUSE the origin is the site's own host — it is what gives the page its cookies and
 * storage, and it names no origin the app lives on.
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

interface Shown {
  /** The site's address, as the bar shows it. */
  address: string;
  /** The `<label>.localhost` origin the frame is on. */
  origin: string;
  /** What the frame loads. */
  src: string;
}

/** The site's address for a location the page reported on its Browser host. */
export function addressOnSite(
  shown: Pick<Shown, "address" | "origin">,
  href: string,
): string | null {
  let at: URL;
  try {
    at = new URL(href);
  } catch {
    return null;
  }
  if (at.origin !== shown.origin) return null;
  return new URL(shown.address).origin + at.pathname + at.search + at.hash;
}

export function BrowserTab({
  id,
  machineId,
  active,
  onTitle,
}: {
  id: string;
  /** The machine the conversation's Workspace is on; null = this server. */
  machineId: string | null;
  active: boolean;
  /** The page's title, for the tab strip. */
  onTitle?: (title: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [typed, setTyped] = useState(() => browserAddress(id));
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Addresses this tab went through, and where in them it stands — the bar's back and forward. */
  const [trail, setTrail] = useState<{ entries: string[]; at: number }>({ entries: [], at: -1 });
  /** Bumped to reload: the frame is keyed on it, since a cross-origin frame cannot be told to. */
  const [generation, setGeneration] = useState(0);
  const { dark, accent, fontScale } = useTheme();

  const show = useCallback(
    async (address: string, record: boolean) => {
      setError(null);
      try {
        const site = await openBrowserSite({ machineId, url: address });
        setShown({ address: site.address, origin: site.origin, src: site.url });
        setTyped(site.address);
        setBrowserAddress(id, site.address);
        if (record) {
          setTrail((trail) => {
            const entries = [...trail.entries.slice(0, trail.at + 1), site.address];
            return { entries, at: entries.length - 1 };
          });
        }
      } catch (err) {
        setError(apiErrorText(err));
      }
    },
    [id, machineId],
  );

  // A restored tab comes back to the page it was on. Once: later navigation is the bar's.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const address = browserAddress(id);
    if (address !== "") void show(address, true);
  }, [id, show]);

  const postTheme = useCallback(() => {
    const frame = frameRef.current;
    if (frame?.contentWindow == null || shown === null) return;
    // To this tab's host and no other: if the frame has wandered elsewhere, nothing is sent.
    frame.contentWindow.postMessage(browserThemeMessage(readDocumentTheme(document)), shown.origin);
  }, [shown]);

  // Past the commit, as the workflow frame does it: the provider stamping the appearance on
  // the app's own document is an ancestor, and its effect runs after this one's.
  useEffect(() => {
    const handle = requestAnimationFrame(postTheme);
    return () => cancelAnimationFrame(handle);
  }, [postTheme, dark, accent, fontScale]);

  useEffect(() => {
    if (shown === null) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== shown.origin) return;
      const data = event.data as { type?: unknown; href?: unknown; title?: unknown; url?: unknown };
      if (data?.type === "penguin:browser:hello") postTheme();
      else if (data?.type === "penguin:browser:location" && typeof data.href === "string") {
        const address = addressOnSite(shown, data.href);
        if (address === null) return;
        setTyped(address);
        setBrowserAddress(id, address);
        if (typeof data.title === "string" && data.title !== "") onTitle?.(data.title);
      } else if (data?.type === "penguin:browser:open" && typeof data.url === "string") {
        void show(data.url, true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, onTitle, postTheme, show, shown]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim() !== "") void show(typed, true);
  };

  const step = (by: -1 | 1) => {
    const at = trail.at + by;
    const address = trail.entries[at];
    if (address === undefined) return;
    setTrail({ entries: trail.entries, at });
    void show(address, false);
  };

  return (
    <div data-testid="browser-tab" className="flex h-full min-h-0 flex-col">
      <form
        onSubmit={submit}
        className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-800"
      >
        <button
          type="button"
          className={BAR_BUTTON}
          title={S.browser.back}
          aria-label={S.browser.back}
          disabled={trail.at <= 0}
          onClick={() => step(-1)}
        >
          <GlyphIcon d={ARROW_LEFT_ICON} size={ICON_SIZE.inlineGlyph} />
        </button>
        <button
          type="button"
          className={BAR_BUTTON}
          title={S.browser.forward}
          aria-label={S.browser.forward}
          disabled={trail.at >= trail.entries.length - 1}
          onClick={() => step(1)}
        >
          <GlyphIcon d={ARROW_RIGHT_ICON} size={ICON_SIZE.inlineGlyph} />
        </button>
        <button
          type="button"
          className={BAR_BUTTON}
          title={S.browser.reload}
          aria-label={S.browser.reload}
          disabled={shown === null}
          onClick={() => {
            // Back to where the page says it is, not to where the tab first opened.
            if (shown !== null && typed.trim() !== "") void show(typed, false);
            setGeneration((n) => n + 1);
          }}
        >
          <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.inlineGlyph} />
        </button>
        <input
          {...noAutofill}
          data-testid="browser-address"
          aria-label={S.browser.address}
          placeholder={S.browser.addressPlaceholder}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onFocus={(event) => event.target.select()}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded border border-gray-200 bg-transparent px-2 font-mono text-xs outline-none focus:border-gray-400 dark:border-gray-700 dark:focus:border-gray-500"
        />
        {shown !== null && machineId === null && (
          <a
            className={BAR_BUTTON}
            href={shown.address}
            target="_blank"
            rel="noreferrer noopener"
            title={S.browser.openExternally}
            aria-label={S.browser.openExternally}
          >
            <GlyphIcon d={EXTERNAL_LINK_ICON} size={ICON_SIZE.inlineGlyph} />
          </a>
        )}
      </form>
      {error !== null && (
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {shown === null ? (
        <EmptyState
          title={S.browser.title}
          description={machineId === null ? S.browser.startLocal : S.browser.startMachine}
        />
      ) : (
        <iframe
          key={`${shown.src}#${generation}`}
          ref={frameRef}
          data-testid="browser-frame"
          title={S.browser.title}
          src={shown.src}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={postTheme}
          // A hidden tab keeps its page (the dock keeps bodies mounted); nothing to pause.
          data-active={active}
          className="min-h-0 w-full flex-1 border-0 bg-white dark:bg-gray-950"
        />
      )}
    </div>
  );
}

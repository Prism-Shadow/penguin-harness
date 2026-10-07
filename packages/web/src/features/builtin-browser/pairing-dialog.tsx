/**
 * Connecting the user's own Chrome: three steps — install the PenguinHarness Browser extension
 * from the release zip, open its pairing page, paste the server's address and a one-time code —
 * as a dialog ("Connect your Chrome…" in the Browser panel's menu, Settings › Browser) and inline
 * in the panel while no Chrome is paired.
 *
 * The address is this page's own origin: the one the browser reaches the server at, which is the
 * right one behind a reverse proxy, where the server cannot know it. The code comes from the
 * window's one pairing code (pairing-code.ts): ten minutes, one use, replaced on request.
 *
 * The dialog waits for the server's word that a Chrome connected — the next one after it opened,
 * so connecting another Chrome while one is connected waits for the new one — then says so and
 * closes itself.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  Button,
  CopyButton,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Link,
  Modal,
  Spinner,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { browserState, subscribeBrowser } from "./browser-store";
import {
  ensurePairingCode,
  forgetPairingCode,
  pairingCode,
  pairingCodeExpired,
  subscribePairingCode,
  type PairingCodeState,
} from "./pairing-code";

/** The extension's release zip; a later Chrome Web Store listing keeps the extension's id. */
export const EXTENSION_DOWNLOAD_URL =
  "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/penguin-browser-extension.zip";

/** How long "Connected" shows before the dialog closes itself. */
const CLOSE_AFTER_MS = 1200;

/** An ISO time as the local clock reads it, HH:mm. */
function clockTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One value the user copies into the extension: its name small and grey, the value itself, Copy. */
function CopyValue({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  testId: string;
}) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <div className={`mt-0.5 flex items-center ${ICON_GAP.row}`}>
        {/* deslop-ignore-next-line 34: a literal the user pastes into the extension, character for character. */}
        <code data-testid={testId} className="min-w-0 break-all font-mono text-xs font-semibold">
          {value}
        </code>
        <CopyButton
          text={value}
          label={`${S.common.copy}: ${label}`}
          size="sm"
          className="shrink-0"
        />
      </div>
      {note}
    </div>
  );
}

/** The code's slot: the code with its expiry, or why there is none, with "New code". */
function CodeValue({ state, now }: { state: PairingCodeState; now: number }) {
  const renew = (
    <Button variant="link" size="sm" onClick={() => void ensurePairingCode(true)}>
      {S.builtinBrowser.pairNewCode}
    </Button>
  );
  if (state.status === "ready" && !pairingCodeExpired(state, now)) {
    return (
      <CopyValue
        label={S.builtinBrowser.pairCode}
        value={state.code}
        testId="browser-pairing-code"
        note={
          <p
            className={`mt-0.5 flex flex-wrap items-center ${ICON_GAP.menu} text-xs text-fg-muted`}
          >
            {S.builtinBrowser.pairCodeExpiry(clockTime(state.expiresAt))}
            {renew}
          </p>
        }
      />
    );
  }
  return (
    <div>
      <p className="text-xs text-fg-muted">{S.builtinBrowser.pairCode}</p>
      <div className={`mt-0.5 flex flex-wrap items-center ${ICON_GAP.menu} text-xs`}>
        {state.status === "failed" ? (
          <span className={toneInk.danger}>{S.builtinBrowser.pairCodeFailed(state.error)}</span>
        ) : state.status === "ready" ? (
          <span className="text-fg-muted">{S.builtinBrowser.pairCodeExpired}</span>
        ) : (
          <Spinner size="sm" label={S.common.loading} className="text-fg-subtle" />
        )}
        {state.status !== "loading" && state.status !== "idle" && renew}
      </div>
    </div>
  );
}

/**
 * The three steps with the address and the code. Showing them asks for a code when the window
 * holds no fresh one, and re-renders when the one shown lapses.
 */
export function PairingSteps({ origin }: { origin: string }) {
  const state = useSyncExternalStore(subscribePairingCode, pairingCode, pairingCode);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void ensurePairingCode();
  }, []);
  const expiresAt = state.status === "ready" ? Date.parse(state.expiresAt) : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return (
    <ol className="list-decimal space-y-3 pl-5 text-sm marker:text-fg-subtle">
      <li>
        <p>{S.builtinBrowser.pairStepInstall}</p>
        <Link href={EXTENSION_DOWNLOAD_URL} external variant="standalone" className="mt-1 text-xs">
          <GlyphIcon d={ICONS.download} size={ICON_SIZE.inlineGlyph} />
          {S.builtinBrowser.pairDownload}
        </Link>
      </li>
      <li>
        <p>{S.builtinBrowser.pairStepOpen}</p>
      </li>
      <li>
        <p>{S.builtinBrowser.pairStepPaste}</p>
        <div className="mt-2 space-y-3">
          <CopyValue
            label={S.builtinBrowser.pairServer}
            value={origin}
            testId="browser-pairing-server"
          />
          <CodeValue state={state} now={now} />
        </div>
      </li>
    </ol>
  );
}

/** The dialog's foot: waiting for the extension, then connected. */
export function PairingStatus({ connected }: { connected: boolean }) {
  return connected ? (
    <p
      role="status"
      className={`mr-auto flex items-center ${ICON_GAP.row} text-xs ${toneInk.success}`}
    >
      <GlyphIcon d={ICONS.checkCircle} size={ICON_SIZE.rowLead} />
      {S.builtinBrowser.pairConnected}
    </p>
  ) : (
    <p role="status" className={`mr-auto flex items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
      <Spinner size="sm" label={S.builtinBrowser.pairWaiting} className="text-fg-subtle" />
      {S.builtinBrowser.pairWaiting}
    </p>
  );
}

/**
 * Whether a Chrome connected after the dialog opened: the server's word on the user's Chrome
 * counted past the count it opened at, the latest of them a connection.
 */
export function connectedSince(
  openedAt: number,
  news: { seq: number; last: string | null },
): boolean {
  return news.seq > openedAt && news.last === "connected";
}

export function PairingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const readNews = () => browserState().extension;
  const news = useSyncExternalStore(subscribeBrowser, readNews, readNews);
  // The count at the opening: the news after it is what the dialog waits for.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  useEffect(() => {
    setOpenedAt(open ? browserState().extension.seq : null);
  }, [open]);
  const connected = openedAt !== null && connectedSince(openedAt, news);

  useEffect(() => {
    if (!connected) return;
    forgetPairingCode();
    const timer = window.setTimeout(onClose, CLOSE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [connected, onClose]);

  return (
    <Modal
      open={open}
      title={S.builtinBrowser.pairTitle}
      onClose={onClose}
      footer={
        <>
          <PairingStatus connected={connected} />
          <Button size="sm" onClick={onClose}>
            {S.common.close}
          </Button>
        </>
      }
    >
      {open && <PairingSteps origin={window.location.origin} />}
    </Modal>
  );
}

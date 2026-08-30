/**
 * The reusable terminal surface: one xterm attached to one server-side terminal over the
 * binary WebSocket stream. Both terminal hosts render this — the standalone `/terminal`
 * page and the in-app dock (terminal-dock.tsx) — so attach/restore/resize behaviour is
 * identical wherever a terminal appears.
 *
 * The host decides *which* terminal to show via the `ensure` callback: it receives the
 * fitted geometry and returns the terminal to attach (reattaching to a stored id, creating
 * a fresh one, honouring URL parameters — whatever that host's policy is). This component
 * only knows how to attach to whatever `ensure` resolved.
 *
 * To restart with a different terminal, remount it (change the React `key`).
 */
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
// Types only (erased at compile time): the xterm runtime stays behind loadXterm() below.
import type { ITheme, Terminal as XTerminal } from "@xterm/xterm";
import { TerminalOpcode, decodeFrame, encodeFrame, encodeResize } from "./terminal-frames";
import { LinkClickTracker, openTerminalLink, positionFromPointer } from "./terminal-links";
import { useTheme } from "../../state/theme";
import { machineForTerminal, terminalUrl } from "../../lib/terminal-machines";
import { useAuth } from "../../state/auth";

/**
 * xterm and its addons load lazily, on the first actual terminal render: their UMD
 * bundles touch browser globals (`self`) at import time, so a static import would crash
 * any Node context that merely reaches this module through the import graph — which is
 * most of the app since the dock mounts in AppLayout (unit tests import pages, pages
 * import the toolbar, the toolbar imports the dock…).
 */
function loadXterm() {
  return Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-clipboard"),
  ]);
}

export interface TerminalInfo {
  id: string;
  /** Stable per-user display number (assigned at creation, never renumbered). */
  seq?: number;
  name: string;
  cwd: string;
  alive: boolean;
  /** Last OSC window title the shell set (debounced server-side), if any. */
  title?: string | null;
}

export type TerminalStatus = "connecting" | "ready" | "exited" | "error";

/**
 * The screen's own palette, one per appearance. Two things matter here.
 *
 * The surface colours are the app's, not a terminal's: `#000000`/`#ffffff` are the body
 * tones (styles.css overrides the neutral gray scale to pure black in dark mode), and the
 * selection matches `::selection` there. A panel docked inside the app that brought its
 * own charcoal along read as a foreign window sitting on top of it.
 *
 * The sixteen ANSI slots are NOT the app's palette and must not be: programs pick them by
 * meaning ("red = error"), so they have to stay recognisable, and legible against the
 * background they land on — which is why light mode has its own set rather than a dimmed
 * copy. These are the values editor terminals converged on; xterm's built-in defaults are
 * VGA-bright and unreadable on white.
 */
const DARK_THEME = {
  background: "#000000",
  foreground: "#f3f4f6",
  cursor: "#f3f4f6",
  cursorAccent: "#000000",
  selectionBackground: "rgba(255, 255, 255, 0.18)",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#111827",
  cursor: "#111827",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0, 0, 0, 0.12)",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

export function terminalTheme(dark: boolean): ITheme {
  return dark ? DARK_THEME : LIGHT_THEME;
}

/**
 * Every terminal round-trip goes through here, and so is addressed to the machine that holds
 * the terminal it names (lib/terminal-machines.ts). `server` is for the one call with no id
 * to route by: creating a terminal names its machine before the terminal exists.
 */
async function request(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<Response> {
  return fetch(terminalUrl(path, server), {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/**
 * A failure the user can act on: the method, the path and the server's own words. A bare
 * "Server did not return a terminal" was the opposite — it hid a 404 (a server without the
 * terminal API, e.g. an older build the desktop shell attached to) behind wording that
 * suggested the terminal itself failed to start.
 */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function httpError(
  path: string,
  init: RequestInit | undefined,
  res: Response,
  body: string,
): HttpStatusError {
  const method = init?.method ?? "GET";
  const detail = body.trim() === "" ? res.statusText : body.trim();
  return new HttpStatusError(res.status, `${method} ${path} → ${res.status} ${detail}`);
}

/** Any non-ok status is an error, 404 included — use probeJson where absence is expected. */
export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<T> {
  const res = await request(path, init, server);
  if (!res.ok) throw httpError(path, init, res, await res.text());
  return (await res.json()) as T;
}

/** Existence probe: 404 means "not there" and answers null; every other failure throws. */
export async function probeJson<T>(
  path: string,
  init?: RequestInit,
  server?: string | null,
): Promise<T | null> {
  const res = await request(path, init, server);
  if (res.status === 404) return null;
  if (!res.ok) throw httpError(path, init, res, await res.text());
  return (await res.json()) as T;
}

/**
 * Always THIS server's stream. A pty on a machine is named in the id instead of the path —
 * `<terminalId>@<machineId>@<userId>` — and this server's platform relays the socket over
 * the forward it holds (server: machines/terminal-relay.ts). The user id is what the
 * runtime's owner check reads; naming anyone else is refused there.
 */
function streamUrl(id: string, cols: number, rows: number, userId: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const machine = machineForTerminal(id);
  const ref = machine === null ? id : `${id}@${machine}@${userId}`;
  return `${scheme}//${location.host}/api/terminals/${ref}/stream?cols=${cols}&rows=${rows}`;
}

export interface TerminalViewProps {
  /**
   * Resolves the terminal to attach, given the geometry the fitted xterm ended up with.
   * Runs once per mount; throwing reports status "error" with the message as detail.
   */
  ensure: (cols: number, rows: number) => Promise<TerminalInfo>;
  onStatus?: (status: TerminalStatus, detail: string) => void;
  onInfo?: (info: TerminalInfo) => void;
  /** OSC window-title changes, parsed by this client's own xterm from the byte stream. */
  onTitle?: (title: string) => void;
  className?: string;
}

export function TerminalView({ ensure, onStatus, onInfo, onTitle, className }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The terminal's OWN appearance setting (light / dark / follow the app, defaulting to
  // dark — see TerminalThemeMode), not the app's. It is repainted in place rather than
  // remounted: the xterm instance, its scrollback and its WebSocket all outlive a switch
  // (the view pool exists to keep exactly those alive). The ref is what lets the
  // once-per-mount effect below read the current appearance without depending on it.
  const { terminalDark } = useTheme();
  const userId = useAuth().user?.userId ?? "";
  const darkRef = useRef(terminalDark);
  darkRef.current = terminalDark;
  const termRef = useRef<XTerminal | null>(null);
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(terminalDark);
  }, [terminalDark]);
  // Kept in refs so the (intentionally once-per-mount) effect always calls the latest
  // callbacks without re-running when a parent re-renders with a new closure.
  const callbacks = useRef({ ensure, onStatus, onInfo, onTitle });
  callbacks.current = { ensure, onStatus, onInfo, onTitle };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let teardown: (() => void) | null = null;

    // Deferred by one macrotask on purpose. StrictMode mounts, unmounts and remounts this
    // effect synchronously in development; opening an xterm and disposing it inside that
    // window leaves xterm's own queued viewport sync to run against a disposed instance
    // ("cannot read properties of undefined (reading 'dimensions')"). Starting a tick later
    // means the throwaway mount never opens a terminal at all.
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      void startTerminal(host).then((dispose) => {
        // The lazy xterm load can outlive a quick unmount: dispose immediately then.
        if (cancelled) dispose();
        else teardown = dispose;
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      teardown?.();
    };

    async function startTerminal(container: HTMLDivElement): Promise<() => void> {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { ClipboardAddon }] = await loadXterm();
      let disposed = false;
      let socket: WebSocket | null = null;
      let exited = false;

      const report = (status: TerminalStatus, detail = ""): void => {
        if (!disposed) callbacks.current.onStatus?.(status, detail);
      };
      /** Resolves clicks on links by position (terminal-links.ts); fed by the providers' hover reports. */
      const links = new LinkClickTracker(() => term.cols);
      /** One abort for every DOM listener this terminal registers; fired at teardown. */
      const listenerAbort = new AbortController();

      const term = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily:
          '"JetBrains Mono", "Fira Code", Menlo, Monaco, "DejaVu Sans Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: terminalTheme(darkRef.current),
        // OSC 8 hyperlinks — how a program that knows the terminal is capable writes a link.
        // The providers only REPORT links here; the click itself is resolved below by
        // position, because xterm's own activation cannot survive a redrawing program
        // (terminal-links.ts). `activate` stays a no-op so a click never opens twice.
        linkHandler: {
          activate: () => {},
          hover: (_event, text, range) => links.hover(text, range),
          leave: () => links.leave(),
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      // Same arrangement for URLs found in the output: the addon reports, the tracker
      // decides. Its built-in handler would also have opened a blank window first, which
      // the desktop shell reads as a link to about:blank.
      term.loadAddon(
        new WebLinksAddon(() => {}, {
          hover: (_event, text, range) => links.hover(text, range),
          leave: () => links.leave(),
        }),
      );
      // OSC 52: a program's own copy reaches the system clipboard — what tmux's copy mode
      // does on every copy, and what makes a selection inside tmux land where a person
      // expects it. WRITE only. The addon's default provider also answers a program's
      // request to READ the clipboard, and terminal output is not something to hand the
      // clipboard's contents to.
      term.loadAddon(
        new ClipboardAddon({
          readText: () => Promise.resolve(""),
          writeText: (_selection, text) =>
            navigator.clipboard?.writeText(text).catch(() => {}) ?? Promise.resolve(),
        }),
      );
      termRef.current = term;
      term.open(container);
      fit.fit();

      // Where a pointer event landed, in the coordinates the link ranges use. The screen
      // element is exactly cols × rows cells, so the cell size falls out of its box.
      const linkPosition = (event: MouseEvent) => {
        const screen = term.element?.querySelector(".xterm-screen");
        if (!screen) return null;
        const box = screen.getBoundingClientRect();
        return positionFromPointer(
          { x: event.clientX, y: event.clientY },
          { left: box.left, top: box.top, width: box.width, height: box.height },
          { cols: term.cols, rows: term.rows, viewportY: term.buffer.active.viewportY },
        );
      };
      const linkTarget = term.element;
      if (linkTarget) {
        const opts = { signal: listenerAbort.signal };
        linkTarget.addEventListener("mousemove", (e) => links.move(linkPosition(e)), opts);
        linkTarget.addEventListener(
          "mousedown",
          (e) => {
            if (e.button === 0) links.down(linkPosition(e), e.clientX, e.clientY);
          },
          opts,
        );
        linkTarget.addEventListener(
          "mouseup",
          (e) => {
            if (e.button !== 0) return;
            const uri = links.up(linkPosition(e), e.clientX, e.clientY);
            if (uri !== null) openTerminalLink(uri);
          },
          opts,
        );
      }

      /** Copies the active selection and clears it — the visual ack that the copy happened. */
      const copySelection = (): void => {
        const selection = term.getSelection();
        if (!selection) return;
        void navigator.clipboard?.writeText(selection).catch(() => {});
        term.clearSelection();
      };
      /** Async-clipboard paste (the paths where no native paste event exists). */
      const pasteFromClipboard = (): void => {
        void navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => {}); // permission denied / insecure context: nothing to paste
      };

      /**
       * Terminal clipboard keys (the Windows Terminal / VS Code conventions — the single
       * Ctrl+Shift+C of the first cut was unreliable: Chrome grabs it for DevTools):
       * - copy: Ctrl+Shift+C, Ctrl+Insert, or plain Ctrl+C while a selection exists
       *   (SIGINT still goes through when nothing is selected);
       * - paste: Ctrl+V, Ctrl+Shift+V and Shift+Insert all ride the browser's NATIVE paste
       *   event into xterm's textarea (no clipboard permission involved) — the browser
       *   fires `paste` for every one of these, so returning false (skip xterm's own key
       *   handling, keep the browser default) is the whole implementation; calling the
       *   async clipboard API here as well double-pastes.
       */
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const key = event.key.toLowerCase();
        const copyCombo =
          (event.ctrlKey && event.shiftKey && key === "c") ||
          (event.ctrlKey && !event.shiftKey && event.key === "Insert") ||
          (event.ctrlKey && !event.shiftKey && !event.altKey && key === "c" && term.hasSelection());
        if (copyCombo) {
          copySelection();
          return false;
        }
        const pasteCombo =
          (event.ctrlKey && !event.altKey && key === "v") ||
          (!event.ctrlKey && event.shiftKey && event.key === "Insert");
        if (pasteCombo) {
          return false; // native paste path (see above)
        }
        return true;
      });

      /**
       * Terminal mouse conventions. All of these step aside when a full-screen app (vim,
       * htop) has turned mouse tracking on — the app owns the pointer then, and xterm
       * forwards the events as escape codes.
       */
      const { signal } = listenerAbort;
      const appOwnsMouse = (): boolean => term.modes.mouseTrackingMode !== "none";
      container.addEventListener(
        "contextmenu",
        (event) => {
          event.preventDefault(); // a terminal never shows the page's context menu
          if (appOwnsMouse()) return;
          // PuTTY-style right click: copy the selection if there is one, else paste.
          if (term.hasSelection()) copySelection();
          else pasteFromClipboard();
        },
        { signal },
      );
      container.addEventListener(
        "mousedown",
        (event) => {
          // Middle click: paste (the X11 convention; browser autoscroll is useless here).
          if (event.button === 1 && !appOwnsMouse()) {
            event.preventDefault();
            pasteFromClipboard();
          }
        },
        { signal },
      );
      // Click-to-focus anywhere in the view, padding included — finishing a selection drag
      // also lands here, which is fine: focusing xterm's textarea keeps the selection.
      container.addEventListener("mouseup", () => term.focus(), { signal });

      // Size ownership follows the user's attention (see server size-ownership.ts): the pty
      // is laid out for the most recent CLAIMING connection, and `update`s from anyone else
      // are ignored. Attaching claims; refocusing this view must claim again, or after
      // another window attaches this one could never win its geometry back.
      container.addEventListener(
        "focusin",
        () => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(encodeResize(term.cols, term.rows, "claim"));
          }
        },
        { signal },
      );

      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeFrame(TerminalOpcode.Input, data));
        }
      });

      // Title changes ride the ordinary byte stream (OSC 0/2); this client's xterm parses
      // them, so the host can mirror the live title (e.g. onto the dock's tab strip).
      term.onTitleChange((title) => {
        if (!disposed) callbacks.current.onTitle?.(title);
      });

      void (async () => {
        try {
          const terminal = await callbacks.current.ensure(term.cols, term.rows);
          if (disposed) return;
          callbacks.current.onInfo?.(terminal);

          socket = new WebSocket(streamUrl(terminal.id, term.cols, term.rows, userId));
          socket.binaryType = "arraybuffer";

          socket.onopen = () => report("ready");
          socket.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const frame = decodeFrame(event.data);
            if (!frame) return;
            switch (frame.opcode) {
              // The restore stream is self-contained (reset + clear + repaint + cursor), so
              // it is written like any other output; calling term.reset() here would race
              // with xterm's parser instead.
              case TerminalOpcode.Restore:
              case TerminalOpcode.Output:
                term.write(frame.text);
                break;
              case TerminalOpcode.Exit: {
                const { exitCode } = JSON.parse(frame.text) as { exitCode: number };
                exited = true;
                report("exited", String(exitCode));
                break;
              }
              default:
                break;
            }
          };
          socket.onerror = () => report("error", "stream error");
          socket.onclose = () => {
            if (!exited) report("error", "stream closed");
          };
        } catch (err) {
          report("error", err instanceof Error ? err.message : String(err));
        }
      })();

      // Geometry changes are `update`s: this connection claimed the size when it attached
      // (?cols/?rows on the stream URL, and again on focusin above); an update only
      // applies while this connection still holds ownership.
      const observer = new ResizeObserver(() => {
        if (disposed) return;
        fit.fit();
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeResize(term.cols, term.rows, "update"));
        }
      });
      observer.observe(container);
      term.focus();

      return () => {
        disposed = true;
        termRef.current = null;
        listenerAbort.abort();
        observer.disconnect();
        socket?.close();
        term.dispose();
      };
    }
  }, []);

  return <div ref={hostRef} className={className ?? "min-h-0 flex-1 overflow-hidden"} />;
}

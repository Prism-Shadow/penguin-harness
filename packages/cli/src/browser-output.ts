/**
 * What `penguin browser` prints. The reader is usually a model, so the output is built to be
 * read at a glance and cheap in tokens, after GenericAgent's web_scan / web_execute_js:
 *
 *   scan         a one-line header naming the tab, the tab list, a `---` rule, then the page
 *   exec, click, type
 *                labelled lines — status and tab, the page's dialogs and how they were answered,
 *                the return value, how many elements changed (the most significant change
 *                indented beneath), transient messages, new tabs and a note — each line present
 *                only when it has something to say
 *
 * A return value longer than {@link RETURN_LIMIT} is cut with a pointer at `--save`. Pure
 * functions over the API's DTOs; commands/browser.ts does the I/O. Docs: /docs/cli §
 * "penguin browser".
 */
import type {
  BrowserBackend,
  BrowserBackendInfo,
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryEntry,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserScanResult,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
} from "@prismshadow/penguin-server/api";
import type { Messages } from "./i18n.js";
import { renderTable } from "./table.js";

/** `return:` shows at most this many characters; `--save` keeps everything. */
export const RETURN_LIMIT = 8000;
/** With `--save`, the terminal shows this much of the value. */
export const SAVED_PREVIEW = 170;
/** A title in the one-line tab list is cut to this length. */
const LIST_TITLE = 40;
/** A title in the `tabs` table is cut to this length. */
const TABLE_TITLE = 60;
/** A dialog's message on its `dialog:` line is cut to this length. */
const DIALOG_MESSAGE = 200;

/** `tab 12 · Your Orders · https://www.amazon.com/your-orders/orders`. */
export function tabHead(tab: BuiltinBrowserTab, t: Messages): string {
  return t.browser.tabHead(tab.id, oneLine(tab.title), tab.url, tab.loading);
}

/** `tabs: *12 Your Orders | 15 Google`: every tab, the active one starred. */
export function tabList(
  tabs: readonly BuiltinBrowserTab[],
  activeTabId: number | null,
  t: Messages,
): string {
  const value =
    tabs.length === 0
      ? t.browser.noTabs()
      : tabs
          .map((tab) => `${tab.id === activeTabId ? "*" : ""}${tab.id} ${label(tab, LIST_TITLE)}`)
          .join(" | ");
  return t.browser.line(t.browser.label.tabs, value);
}

/**
 * `status: available · backend: chrome (Chrome 130 on macOS, extension 0.2.13)` and the tab list,
 * or `status: unavailable (<reason>) · backend: …` with a `note:` saying what to tell the user. The
 * backend is the one the user chose (the agent never picks it); a server older than the second
 * backend names none, and the line then ends at the status.
 */
export function renderStatus(status: BuiltinBrowserStatus, t: Messages): string {
  const { label, line } = t.browser;
  const backend = backendSuffix(status, t);
  if (!status.available) {
    const reason = status.reason ?? "not_desktop";
    return lines([
      `${line(label.status, t.browser.unavailable(reason))}${backend}`,
      line(label.note, t.browser.unavailableHint(reason)),
    ]);
  }
  return lines([
    `${line(label.status, t.browser.available())}${backend}`,
    tabList(status.tabs, status.activeTabId, t),
    ...loadLines(status, t),
  ]);
}

/** ` · backend: <backend>`, naming the user's Chrome when one is paired; empty without a backend. */
function backendSuffix(status: BuiltinBrowserStatus, t: Messages): string {
  // Both optional at runtime: an older server answers without them.
  const backend = status.backend as BrowserBackend | undefined;
  const backends = status.backends as BrowserBackendInfo[] | undefined;
  if (backend === undefined) return "";
  const extension =
    backend === "chrome"
      ? backends?.find((info) => info.backend === "chrome")?.extension
      : undefined;
  const value = t.browser.backendValue(
    backend,
    extension !== undefined
      ? { name: oneLine(extension.name), version: extension.version }
      : undefined,
  );
  return ` · ${t.browser.line(t.browser.label.backend, value)}`;
}

/** A size in KB as the status shows it: `640 MB`, or `2.1 GB` from about a gigabyte up. */
export function formatKB(kb: number): string {
  const gb = kb / (1024 * 1024);
  return gb >= 0.95 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(kb / 1024))} MB`;
}

/**
 * `memory:` (the pages' memory, the tab count, the computer's own when the server reports it),
 * then a `warning:` while the server warns about the load. Nothing before the first measurement,
 * or with no tab open.
 */
function loadLines(status: BuiltinBrowserStatus, t: Messages): string[] {
  const { metrics } = status;
  if (metrics === undefined || status.tabs.length === 0) return [];
  const { label, line } = t.browser;
  const system =
    metrics.system !== undefined
      ? { free: formatKB(metrics.system.freeKB), total: formatKB(metrics.system.totalKB) }
      : undefined;
  return [
    line(label.memory, t.browser.memoryLine(formatKB(metrics.totalKB), status.tabs.length, system)),
    ...(metrics.warnings.length > 0
      ? [line(label.warning, t.browser.loadWarning(metrics.warnings))]
      : []),
  ];
}

/** The `tabs` table: id (the active one starred), title, URL. */
export function renderTabs(res: BuiltinBrowserTabsResponse, t: Messages): string {
  if (res.tabs.length === 0) return lines([tabList([], null, t)]);
  return renderTable(
    [t.browser.colId(), t.browser.colTitle(), t.browser.colUrl()],
    res.tabs.map((tab) => [
      `${tab.id === res.activeTabId ? "*" : ""}${tab.id}`,
      label(tab, TABLE_TITLE),
      tab.url,
    ]),
  );
}

export function renderScan(res: BuiltinBrowserScanResult, t: Messages): string {
  return lines([
    tabHead(res.tab, t),
    tabList(res.tabs, res.activeTabId, t),
    "---",
    ...(res.content ? [res.content.replace(/\n+$/, "")] : []),
  ]);
}

/**
 * The labelled lines of an exec, click or type result. `alwaysReturn` prints `return:` even for
 * an undefined value (exec: a missing `return` is the commonest mistake, and it should show);
 * `savedTo` is the file `--save` wrote the whole value to.
 */
export function renderExec(
  res: BuiltinBrowserExecResult,
  t: Messages,
  opts: { alwaysReturn: boolean; savedTo?: string },
): string {
  const { label, line } = t.browser;
  const out = [
    [
      line(label.status, res.status),
      line(label.tab, String(res.tabId)),
      ...(res.reloaded ? [line(label.page, t.browser.reloaded())] : []),
    ].join("   "),
  ];
  if (res.error !== undefined) out.push(line(label.error, oneLine(res.error)));
  if (res.clicked !== undefined) {
    const { tag, text, x, y } = res.clicked;
    const shown = text === undefined ? undefined : shorten(oneLine(text), LIST_TITLE);
    out.push(line(label.clicked, t.browser.clickedAt(tag, shown, Math.round(x), Math.round(y))));
  }
  for (const dialog of res.dialogs ?? []) {
    const message = shorten(oneLine(dialog.message), DIALOG_MESSAGE);
    out.push(line(label.dialog, t.browser.dialogAnswered(dialog.type, message, dialog.accepted)));
  }
  const failedEmpty = res.status === "failed" && res.value === undefined;
  if (!failedEmpty && (opts.alwaysReturn || res.value !== undefined)) {
    out.push(returnLine(res.value, t, opts.savedTo));
  }
  if (res.diff !== undefined) {
    out.push(line(label.diff, t.browser.elementsChanged(res.diff.changed)));
    if (res.diff.topChange) out.push(indent(res.diff.topChange.replace(/\n+$/, "")));
  }
  if (res.transients !== undefined && res.transients.length > 0) {
    out.push(line(label.transients, res.transients.map((s) => JSON.stringify(s)).join(" · ")));
  }
  if (res.newTabs !== undefined && res.newTabs.length > 0) {
    out.push(line(label.newTabs, res.newTabs.map((tab) => `${tab.id} ${tab.url}`).join(" · ")));
  }
  if (res.suggestion) out.push(line(label.note, res.suggestion));
  return lines(out);
}

/** A return value as text: a string as-is (it is usually text, or JSON the script built), anything else as compact JSON. */
export function returnText(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/**
 * `return: <value>`, or `return:` over an indented block when the value spans lines. Cut at
 * {@link RETURN_LIMIT} with a pointer at `--save`; after `--save`, only the first
 * {@link SAVED_PREVIEW} characters and where the rest went.
 */
function returnLine(value: unknown, t: Messages, savedTo: string | undefined): string {
  const full = returnText(value);
  let text = full;
  let suffix = "";
  if (savedTo !== undefined) {
    text = full.length > SAVED_PREVIEW ? `${full.slice(0, SAVED_PREVIEW)}…` : full;
    suffix = ` ${t.browser.savedTo(savedTo)}`;
  } else if (full.length > RETURN_LIMIT) {
    text = full.slice(0, RETURN_LIMIT);
    suffix = ` ${t.browser.truncatedSave()}`;
  }
  const { label, line } = t.browser;
  return text.includes("\n")
    ? `${line(label.return, "").trimEnd()}\n${indent(`${text}${suffix}`)}`
    : line(label.return, `${text}${suffix}`);
}

/** The `cdp` result: compact JSON, cut at {@link RETURN_LIMIT} with a pointer at `--json`. */
export function renderCdpResult(result: unknown, t: Messages): string {
  const text = JSON.stringify(result ?? null);
  return lines([
    text.length > RETURN_LIMIT
      ? `${text.slice(0, RETURN_LIMIT)} ${t.browser.truncatedJson()}`
      : text,
  ]);
}

export function renderImportSources(
  sources: readonly BuiltinBrowserImportSource[],
  t: Messages,
): string {
  if (sources.length === 0) return lines([t.browser.noSources()]);
  return renderTable(
    [t.browser.colId(), t.browser.colBrowser(), t.browser.colProfile(), t.browser.colData()],
    sources.map((s) => [
      s.id,
      s.browserName,
      s.profileName,
      t.browser.importData(s.hasCookies, s.hasHistory),
    ]),
  );
}

export function renderImportResult(res: BuiltinBrowserImportResult, t: Messages): string {
  const { label, line } = t.browser;
  return lines([
    line(label.source, res.sourceId),
    ...(res.cookies !== undefined
      ? [line(label.cookies, t.browser.importCookies(res.cookies))]
      : []),
    ...(res.history !== undefined
      ? [line(label.history, t.browser.importHistory(res.history))]
      : []),
    ...res.warnings.map((warning) => line(label.warning, oneLine(warning))),
  ]);
}

/**
 * One entry per line, in the server's order (most visited first, then most recent), the visit
 * count first so the order reads: `4 visits · 2026-09-23 14:03 · Your Orders · https://…`
 * (local time).
 */
export function renderHistory(entries: readonly BuiltinBrowserHistoryEntry[], t: Messages): string {
  if (entries.length === 0) return lines([t.browser.noHistory()]);
  return lines(
    entries.map((e) =>
      [
        t.browser.visits(e.visitCount),
        localMinute(e.lastVisitAt),
        ...(e.title ? [oneLine(e.title)] : []),
        e.url,
      ].join(" · "),
    ),
  );
}

/** `yyyy-mm-dd hh:mm` in local time. */
export function localMinute(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A tab's title for a list (its URL until the page names itself), on one line and cut. */
function label(tab: BuiltinBrowserTab, max: number): string {
  return shorten(oneLine(tab.title) || tab.url, max);
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((row) => `  ${row}`)
    .join("\n");
}

function lines(rows: readonly string[]): string {
  return `${rows.join("\n")}\n`;
}

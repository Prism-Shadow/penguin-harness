/**
 * The Trace file view's event pager (features/traces/trace-events-loader.ts).
 *
 * What matters here is that the walk covers the WHOLE file: the analysis beside it attributes
 * messages to rounds by index range, so an event the walk never fetched is a round that renders
 * an empty message list. The cases below are the four ways a walk ends — the file is covered,
 * the file cannot be paged any further, the reader left, and the page cap — plus the one that
 * moves the finish line, a file appended to while the walk is running.
 */
import { describe, expect, it } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceEventsResponse } from "@prismshadow/penguin-server/api";
import {
  MAX_TRACE_EVENT_PAGES,
  TRACE_EVENT_PAGE_SIZE,
  loadTraceEventPages,
} from "../src/features/traces/trace-events-loader";

/** One synthetic event, identified by its index so a page's slice can be checked exactly. */
const event = (i: number): OmniMessage => ({
  timestamp: "2026-09-12T00:00:00.000Z",
  type: "model_msg",
  payload: { type: "text", role: "assistant", text: `m${i}` },
});

const textsOf = (events: readonly OmniMessage[]): string[] =>
  events.map((m) => (m.payload as { text: string }).text);

const expectedTexts = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `m${from + i}`);

/**
 * A fake events endpoint over a file of `size` synthetic events.
 *
 * `state.size` is what the file can actually deliver and `state.total` what it reports, held
 * apart so a truncated file (a `total` above what comes back) can be staged. `serverLimit`
 * clamps a request the way the real endpoint does, and `onFetch` is the hook the growing-file,
 * truncation and cancellation cases use to change the file between two pages.
 */
function fakeFile(
  size: number,
  opts: { serverLimit?: number; onFetch?: (call: number) => void } = {},
) {
  const state = { size, total: size };
  const calls: { offset: number; limit: number }[] = [];
  const pages: TraceEventsResponse[] = [];
  const fetchPage = (offset: number, limit: number): Promise<TraceEventsResponse> => {
    calls.push({ offset, limit });
    opts.onFetch?.(calls.length);
    const capped = Math.min(limit, opts.serverLimit ?? limit);
    const events: OmniMessage[] = [];
    for (let i = offset; i < Math.min(offset + capped, state.size); i++) events.push(event(i));
    return Promise.resolve({ events, offset, limit: capped, total: state.total });
  };
  return {
    state,
    calls,
    pages,
    fetchPage,
    onPage: (page: TraceEventsResponse) => pages.push(page),
  };
}

describe("loadTraceEventPages", () => {
  it("pages a 2500-event file in three requests, reporting every page in file order", async () => {
    const f = fakeFile(2500);
    await loadTraceEventPages(f.fetchPage, { pageSize: 1000, onPage: f.onPage });

    expect(f.calls).toEqual([
      { offset: 0, limit: 1000 },
      { offset: 1000, limit: 1000 },
      { offset: 2000, limit: 1000 },
    ]);
    expect(f.pages.map((p) => p.offset)).toEqual([0, 1000, 2000]);
    expect(f.pages.map((p) => p.events.length)).toEqual([1000, 1000, 500]);
    expect(textsOf(f.pages[0]!.events)).toEqual(expectedTexts(0, 1000));
    expect(textsOf(f.pages[1]!.events)).toEqual(expectedTexts(1000, 1000));
    expect(textsOf(f.pages[2]!.events)).toEqual(expectedTexts(2000, 500));
    // Concatenated, the pages are the file — nothing dropped, nothing repeated.
    expect(textsOf(f.pages.flatMap((p) => p.events))).toEqual(expectedTexts(0, 2500));
  });

  it("advances by what a page delivered, not by the page size it asked for", async () => {
    // A server that clamps `limit` below the asked-for page size must not leave a hole behind.
    const f = fakeFile(500, { serverLimit: 200 });
    await loadTraceEventPages(f.fetchPage, { pageSize: 1000, onPage: f.onPage });

    expect(f.calls.map((c) => c.offset)).toEqual([0, 200, 400]);
    expect(textsOf(f.pages.flatMap((p) => p.events))).toEqual(expectedTexts(0, 500));
  });

  it("follows a file that was appended to while the walk was running", async () => {
    // The Session keeps writing: the file grows by 600 events after the second page was served.
    const f = fakeFile(2500, {
      onFetch: (call) => {
        if (call === 2) {
          f.state.size = 3100;
          f.state.total = 3100;
        }
      },
    });
    await loadTraceEventPages(f.fetchPage, { pageSize: 1000, onPage: f.onPage });

    // A walk pinned to the FIRST page's total would have stopped at 2500, three pages in.
    expect(f.calls.map((c) => c.offset)).toEqual([0, 1000, 2000, 3000]);
    expect(f.pages.map((p) => p.total)).toEqual([2500, 3100, 3100, 3100]);
    expect(textsOf(f.pages.flatMap((p) => p.events))).toEqual(expectedTexts(0, 3100));
  });

  it("ends the walk on a page with no events, however long the file claims to be", async () => {
    // A file truncated under the reader: `total` still says 3000, nothing comes back past 1000.
    const f = fakeFile(3000, {
      onFetch: (call) => {
        if (call === 2) f.state.size = 1000;
      },
    });
    await loadTraceEventPages(f.fetchPage, { pageSize: 1000, onPage: f.onPage });

    expect(f.calls.map((c) => c.offset)).toEqual([0, 1000]);
    expect(f.pages.map((p) => p.events.length)).toEqual([1000, 0]);
    expect(f.pages[1]!.total).toBe(3000);
  });

  it("stops without reporting or requesting anything more once it is cancelled", async () => {
    const signal = { cancelled: false };
    const f = fakeFile(4000);
    await loadTraceEventPages(f.fetchPage, {
      pageSize: 1000,
      signal,
      onPage: (page) => {
        f.onPage(page);
        // The view is gone — the file switched, or the panel unmounted — mid-walk.
        signal.cancelled = true;
      },
    });

    expect(f.calls).toEqual([{ offset: 0, limit: 1000 }]);
    expect(f.pages).toHaveLength(1);
  });

  it("caps a walk that never finishes, rather than requesting for as long as the view is open", async () => {
    // A server reporting a total it never delivers: one event per page, forever.
    const f = fakeFile(Number.MAX_SAFE_INTEGER, { serverLimit: 1 });
    await loadTraceEventPages(f.fetchPage, { pageSize: 1000, onPage: f.onPage });

    expect(f.calls).toHaveLength(MAX_TRACE_EVENT_PAGES);
  });

  it("resolves with the last page's total, the walk's final word on the file's length", async () => {
    // The caller truncates to this number, so an earlier walk's rows cannot outlive a file
    // that came back shorter than it was read as before.
    const plain = fakeFile(2500);
    await expect(
      loadTraceEventPages(plain.fetchPage, { pageSize: 1000, onPage: plain.onPage }),
    ).resolves.toBe(2500);

    const grown = fakeFile(2500, {
      onFetch: (call) => {
        if (call === 2) {
          grown.state.size = 3100;
          grown.state.total = 3100;
        }
      },
    });
    await expect(
      loadTraceEventPages(grown.fetchPage, { pageSize: 1000, onPage: grown.onPage }),
    ).resolves.toBe(3100);

    // Cancelled before any page was reported, there is no answer to give: 0, which the caller
    // must not act on — it checks its own cancellation first.
    const gone = fakeFile(2500);
    await expect(
      loadTraceEventPages(gone.fetchPage, {
        pageSize: 1000,
        signal: { cancelled: true },
        onPage: gone.onPage,
      }),
    ).resolves.toBe(0);
    expect(gone.calls).toEqual([]);
  });

  it("asks for the largest page the events endpoint accepts", () => {
    // The route parses `limit` as 1-1000 (server/src/http/validate.ts); a larger ask is a 400.
    expect(TRACE_EVENT_PAGE_SIZE).toBe(1000);
  });
});

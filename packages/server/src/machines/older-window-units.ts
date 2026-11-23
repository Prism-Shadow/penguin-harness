/**
 * `units` on a window page read from a machine on an older build (history-sync.ts's HTTP
 * fallback, its `/messages`): that build's page has none, and every page the Web App receives
 * says how many Tasks it holds (api/types.ts MessagesPageInfo.units).
 *
 * Counted as a build with `history-lines` counts it, with the server's own scanner: a window
 * starts where its cut put it, on a Task boundary, so a fresh scan of its Trace records sees the
 * boundaries the cut counted. The held inputs a newest window appends after its records carry no
 * trace position and are not the window's Tasks. On a page whose records carry none either (a
 * build before #297, older than every machine install, and before task records), nothing tells
 * them apart; the scanner counts a run of inputs as one Task, so inputs held behind the running
 * Task's output count one Task over at most, and inputs behind its prompt count none.
 *
 * Goes with the fallback itself, once no supported machine predates `history-lines`.
 */
import type { MessagesResponse } from "../api/types.js";
import { initialScanState, scanMessages } from "../services/message-window.js";

/** `response` with its page's `units`, counted when the machine's own page has none. */
export async function withWindowUnits(response: MessagesResponse): Promise<MessagesResponse> {
  const page = response.page as (MessagesResponse["page"] & { units?: unknown }) | undefined;
  if (page === undefined || typeof page.units === "number") return response;
  const traced = response.messages.filter((m) => m.tracePosition !== undefined);
  // A build older than trace positions marks none: then every record is counted (see above).
  const records = traced.length > 0 ? traced : response.messages;
  let units = 0;
  await scanMessages(initialScanState(), records, () => (units += 1), null);
  return { ...response, page: { ...page, units } };
}

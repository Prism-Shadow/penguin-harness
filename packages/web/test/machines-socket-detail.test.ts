/**
 * The Machines page's unfolded record, and the socket line in it in particular
 * (features/machines/machines-page.tsx).
 *
 * The socket fact has its own derivation (`socketReading`, machines-view.test.ts) — which state
 * reads as which word and which tone. This is the other half of acceptance: that the card
 * actually SHOWS it, with how long the state has held and the transport's own words beside the
 * word, that a socket needing attention carries the tone's ink, and that a machine with no
 * socket gets no line at all rather than a misleading "connected".
 *
 * The layer is the record component itself, rendered to static markup (react-dom/server) —
 * this package's Node environment has no DOM, but it has markup, which is the harness the
 * markdown, message-stream and field-mark tests already use. The page's own polling hands the
 * fresh fact in; nothing here renders the page or its effects.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MachineInfo, MachineSocketFact } from "@prismshadow/penguin-server/api";
import { MachineSocketDetails as MachineRecord } from "../src/features/machines/machine-detail-dialog";
import { formatDateTime, formatRelativeShort } from "../src/lib/format";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

const NAS = "2026-08-24T12:00:00.000Z";

const machine = (socket: MachineSocketFact | null): MachineInfo => ({
  id: "ssh:nas",
  alias: "nas",
  machineId: "noeSE0FFHhNXl2J5",
  installed: { version: "9.9.9", at: NAS },
  local: false,
  connection: { pid: 4242 },
  socket,
  api: null,
  root: "$HOME/.penguin/data",
  status: { state: "running", checkedAt: NAS, port: 7364 },
});

const record = (socket: MachineSocketFact | null, locale: "zh" | "en" = "en"): string => {
  setActiveStrings(locale === "en" ? en : zh);
  return renderToStaticMarkup(createElement(MachineRecord, { machine: machine(socket), locale }));
};

describe("the Machines record's socket line", () => {
  it("shows the state, how long it has held, and the transport's own words", () => {
    // Five and a half minutes back: the compact relative form floors to whole minutes, so the
    // reading is "5m" whenever the test runs, and the exact instant rides the `title`.
    const since = new Date(Date.now() - 5 * 60_000 - 30_000).toISOString();
    const html = record({
      state: "failed",
      since,
      detail: "connect ECONNREFUSED 10.0.0.7:7364",
    });
    expect(html).toContain("API socket");
    // The instant is the app's own compact relative form (lib/format's formatRelativeShort, the
    // one the sidebar and the proposal list read), so "how long" is on the line — not a second
    // convention invented for this page.
    expect(html).toContain(`Failed · ${formatRelativeShort(since, "en")}`);
    expect(html).toContain(formatDateTime(since));
    expect(html).toContain("connect ECONNREFUSED 10.0.0.7:7364");
  });

  it("carries the tone's ink when the socket names something to act on, and none when it does not", () => {
    expect(record({ state: "failed", since: NAS })).toContain("text-red-600");
    expect(record({ state: "refused", since: NAS })).toContain("text-amber-600");
    // A live handshake is contact, not a verdict: no alert ink on the line.
    const connected = record({ state: "connected", since: NAS });
    expect(connected).toContain("Connected · ");
    expect(connected).not.toContain("text-red-600");
    expect(connected).not.toContain("text-amber-600");
  });

  it("writes no socket line where the server reported no socket", () => {
    // `local`, and every machine until a stream has asked: the line is absent rather than
    // reading "connected" off an absent fact.
    expect(record(null)).not.toContain("API socket");
  });

  it("reads in the active language, like the rest of the detail list", () => {
    const socket: MachineSocketFact = { state: "dialling", since: NAS };
    expect(record(socket, "zh")).toContain("API 套接字");
    expect(record(socket, "zh")).toContain("拨号中");
    expect(record(socket, "en")).toContain("Dialling");
  });
});

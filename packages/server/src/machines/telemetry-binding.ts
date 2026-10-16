/**
 * Connects the machine collection points (transport/timings.ts) to the Telemetry switch: while
 * it is on, the process-wide slot holds a sink that records into this App generation's buffer;
 * off, the slot is empty and every point costs one read and one comparison again.
 *
 * The slot outlives a generation — a held ssh session is delivered across a hot push — so a
 * generation only ever empties the slot while it still holds ITS sink. The successor's setup
 * runs before the outgoing generation's dispose; by then the slot holds the successor's sink
 * (or nothing, if its switch is off and it found the old one), and the dispose leaves it be.
 */
import type { Telemetry } from "../mechanisms/telemetry.js";
import { setTimingsSink, timingsSink } from "./transport/index.js";
import type { TimingsSink } from "./transport/index.js";

/** Follows `telemetry`'s switch until the returned dispose runs. */
export function bindMachineTimings(telemetry: Telemetry): () => void {
  // The buffer stamps its own time; the rest of a machine sample is a sample input as it is.
  const sink: TimingsSink = ({ ts: _ts, ...sample }) => {
    telemetry.record(sample);
  };
  const release = () => {
    if (timingsSink() === sink) setTimingsSink(null);
  };
  const unwatch = telemetry.watch((on) => (on ? setTimingsSink(sink) : release()));
  return () => {
    unwatch();
    release();
  };
}

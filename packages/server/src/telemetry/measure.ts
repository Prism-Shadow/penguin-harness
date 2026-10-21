/**
 * The calls a measured module makes (PRFC-0008), for a Telemetry dependency that may be absent
 * (narrow trees and tests omit it): with none, or with the switch off, they just run.
 */
import type { TelemetryKeys, TelemetrySampleInput } from "../api/types.js";
import type { Telemetry } from "../mechanisms/telemetry.js";

type Describe<T> = (result: T) => Pick<TelemetrySampleInput, "bytes" | "attrs">;

export function spanIn<T>(
  telemetry: Telemetry | undefined,
  probe: string,
  keys: TelemetryKeys,
  run: () => Promise<T>,
  describe?: Describe<T>,
): Promise<T> {
  return telemetry ? telemetry.span(probe, keys, run, describe) : run();
}

export function timeIn<T>(
  telemetry: Telemetry | undefined,
  probe: string,
  keys: TelemetryKeys,
  run: () => T,
  describe?: Describe<T>,
): T {
  return telemetry ? telemetry.time(probe, keys, run, describe) : run();
}

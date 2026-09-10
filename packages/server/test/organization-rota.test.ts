/**
 * Rota advice for a calendar write: a start minute another employee's recurring event
 * already holds, a second recurring event on the same cadence for one employee, and the
 * `--start-at now` habit that pins every event scheduled that way to one minute. The minute
 * is read in the organization's timezone, and a disabled event is nobody's rota.
 */
import { describe, expect, it } from "vitest";
import { rotaWarnings } from "../src/runtime/organization/rota.js";
import type { RotaEvent } from "../src/runtime/organization/rota.js";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-09-01T01:00:00Z");

function event(over: Partial<RotaEvent> & Pick<RotaEvent, "agentId" | "name">): RotaEvent {
  return {
    enabled: true,
    startAt: "2026-09-02T10:00:00+08:00",
    period: "1d",
    ...over,
  };
}

describe("rotaWarnings", () => {
  it("names another employee's recurring event on the same start minute", () => {
    const hr = event({ agentId: "acme_hr", name: "hr-audit" });
    const dev = event({ agentId: "acme_dev", name: "daily-sweep" });
    expect(rotaWarnings([hr, dev], dev, NOW, TZ)).toEqual([
      "`acme_hr/hr-audit` also fires at 10:00; give every employee its own minute.",
    ]);
    // The minute is the organization's, not UTC: the same instant written with another
    // offset is the same minute, and half an hour later is a different one.
    const sameMinute = event({
      agentId: "acme_dev",
      name: "daily-sweep",
      startAt: "2026-09-02T02:00:00Z",
    });
    expect(rotaWarnings([hr, sameMinute], sameMinute, NOW, TZ)).toHaveLength(1);
    const staggered = event({
      agentId: "acme_dev",
      name: "daily-sweep",
      startAt: "2026-09-02T10:30:00+08:00",
    });
    expect(rotaWarnings([hr, staggered], staggered, NOW, TZ)).toEqual([]);
  });

  it("ignores a disabled or one-shot neighbour, and the written event's own row", () => {
    const disabled = event({ agentId: "acme_hr", name: "hr-audit", enabled: false });
    const oneShot = event({ agentId: "acme_ops", name: "kickoff", period: undefined });
    const dev = event({ agentId: "acme_dev", name: "daily-sweep" });
    expect(rotaWarnings([disabled, oneShot, dev], dev, NOW, TZ)).toEqual([]);
    // A disabled event is nobody's rota, so writing one says nothing either.
    const off = event({ agentId: "acme_dev", name: "daily-sweep", enabled: false });
    const hr = event({ agentId: "acme_hr", name: "hr-audit" });
    expect(rotaWarnings([hr, off], off, NOW, TZ)).toEqual([]);
  });

  it("names a second recurring event of the same period on one employee", () => {
    const first = event({ agentId: "acme_dev", name: "daily-sweep" });
    const second = event({
      agentId: "acme_dev",
      name: "second-sweep",
      startAt: "2026-09-02T15:00:00+08:00",
    });
    expect(rotaWarnings([first, second], second, NOW, TZ)).toEqual([
      "`acme_dev` already has a recurring event `daily-sweep` with period 1d; one sweep per employee.",
    ]);
    // A different cadence beside a daily sweep is what the rota allows.
    const weekly = event({
      agentId: "acme_dev",
      name: "retro",
      period: "7d",
      startAt: "2026-09-02T15:00:00+08:00",
    });
    expect(rotaWarnings([first, weekly], weekly, NOW, TZ)).toEqual([]);
  });

  it("flags a recurring event started at 'now', and lets a one-shot one through", () => {
    const now = event({
      agentId: "acme_dev",
      name: "daily-sweep",
      startAt: new Date(NOW + 30_000).toISOString(),
    });
    expect(rotaWarnings([now], now, NOW, TZ)).toEqual([
      "A recurring event started at 'now' shares its minute with every other event started the same way; pick the role's hour.",
    ]);
    const oneShot = { ...now, period: undefined };
    expect(rotaWarnings([oneShot], oneShot, NOW, TZ)).toEqual([]);
    const later = event({
      agentId: "acme_dev",
      name: "daily-sweep",
      startAt: new Date(NOW + 600_000).toISOString(),
    });
    expect(rotaWarnings([later], later, NOW, TZ)).toEqual([]);
  });

  it("reports every problem the one write has, in the order to fix them", () => {
    const hr = event({
      agentId: "acme_hr",
      name: "hr-audit",
      startAt: new Date(NOW).toISOString(),
    });
    const existing = event({ agentId: "acme_dev", name: "daily-sweep" });
    const written = event({
      agentId: "acme_dev",
      name: "extra-sweep",
      startAt: new Date(NOW).toISOString(),
    });
    expect(rotaWarnings([hr, existing, written], written, NOW, TZ)).toEqual([
      expect.stringContaining("`acme_hr/hr-audit` also fires at"),
      "`acme_dev` already has a recurring event `daily-sweep` with period 1d; one sweep per employee.",
      "A recurring event started at 'now' shares its minute with every other event started the same way; pick the role's hour.",
    ]);
  });

  it("says nothing about an event whose start_at is not an instant", () => {
    const broken = event({ agentId: "acme_dev", name: "daily-sweep", startAt: "whenever" });
    const hr = event({ agentId: "acme_hr", name: "hr-audit" });
    expect(rotaWarnings([hr, broken], broken, NOW, TZ)).toEqual([]);
  });
});

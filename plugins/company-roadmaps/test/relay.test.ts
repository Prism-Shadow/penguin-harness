/**
 * The relay's depth: who a room message goes to, and why two room sessions answering each
 * other stop.
 */
import { describe, expect, it } from "vitest";
import { planRelay, type RoomMessage } from "../src/index.js";

function msg(sender: string, hop = 0): RoomMessage {
  return { id: "m", time: "t", sender, hop, text: "x", mentions: [] };
}

describe("planRelay", () => {
  it("relays a person's message to every room session at depth 0", () => {
    const depths: Record<string, number> = {};
    expect(planRelay(msg("user:boss"), ["acme_dev", "acme_web"], depths, 3)).toEqual({
      depth: 0,
      to: ["acme_dev", "acme_web"],
    });
    expect(depths).toEqual({ acme_dev: 0, acme_web: 0 });
  });

  it("never relays a message back to the session of the employee who wrote it", () => {
    const depths = { acme_dev: 0, acme_web: 0 };
    expect(planRelay(msg("agent:acme_dev", 1), ["acme_dev", "acme_web"], depths, 3).to).toEqual([
      "acme_web",
    ]);
  });

  it("stops two room sessions answering each other at the limit", () => {
    const open = ["acme_dev", "acme_web"];
    const depths: Record<string, number> = {};
    const delivered: string[][] = [];
    delivered.push(planRelay(msg("user:boss"), open, depths, 3).to);
    // Each answers the one message relayed to it last, back and forth.
    const speakers = ["acme_dev", "acme_web", "acme_dev"];
    for (const s of speakers) delivered.push(planRelay(msg(`agent:${s}`, 1), open, depths, 3).to);
    expect(delivered).toEqual([
      ["acme_dev", "acme_web"], // the person, at depth 0
      ["acme_web"], // dev answers at 1
      ["acme_dev"], // web answers at 2
      [], // dev answers at 3, the limit: web receives nothing, so nothing more is answered
    ]);
    expect(depths).toEqual({ acme_dev: 2, acme_web: 1 });
  });

  it("starts over at 0 when a person speaks again", () => {
    const depths = { acme_dev: 2, acme_web: 2 };
    expect(planRelay(msg("user:boss"), ["acme_dev", "acme_web"], depths, 3).depth).toBe(0);
    expect(depths).toEqual({ acme_dev: 0, acme_web: 0 });
  });

  it("counts an employee without a room session here at the organization's hop", () => {
    const depths: Record<string, number> = {};
    expect(planRelay(msg("agent:acme_qa", 2), ["acme_dev"], depths, 3)).toEqual({
      depth: 2,
      to: ["acme_dev"],
    });
    expect(planRelay(msg("agent:acme_qa", 3), ["acme_dev"], depths, 3).to).toEqual([]);
  });

  it("relays no system line", () => {
    expect(planRelay(msg("system"), ["acme_dev"], {}, 3)).toEqual({ depth: null, to: [] });
  });
});

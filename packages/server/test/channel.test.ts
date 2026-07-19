/**
 * SSE channel unit tests: epoch-string ids (`<epoch>-<seq>`), ring buffer (dual
 * count/byte caps), Last-Event-ID replay hit determination (cross-epoch always misses),
 * private sends bypass the buffer, idle reclamation (active channels are skipped).
 */
import { describe, expect, it } from "vitest";
import { Channel, ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";

/** A valid epoch prefix guaranteed to differ from ch.epoch (for building a cross-epoch Last-Event-ID). */
function foreignEpoch(ch: Channel): string {
  return ch.epoch === "00000000" ? "11111111" : "00000000";
}

describe("channel", () => {
  it("publish 分配 `<epoch>-<seq>` 单调 id 并广播", () => {
    const ch = new Channel();
    const seen: ChannelEvent[] = [];
    ch.subscribe((e) => seen.push(e));
    ch.publish({ a: 1 });
    ch.publish({ b: 2 }, "server_event");
    expect(ch.epoch).toMatch(/^[0-9a-f]{8}$/);
    expect(seen.map((e) => e.id)).toEqual([`${ch.epoch}-1`, `${ch.epoch}-2`]);
    expect(seen[0]!.event).toBeUndefined();
    expect(seen[1]!.event).toBe("server_event");
    expect(JSON.parse(seen[0]!.data)).toEqual({ a: 1 });
  });

  it("退订后不再接收", () => {
    const ch = new Channel();
    const seen: ChannelEvent[] = [];
    const unsub = ch.subscribe((e) => seen.push(e));
    ch.publish("x");
    unsub();
    ch.publish("y");
    expect(seen).toHaveLength(1);
  });

  it("按条数上限淘汰最旧事件", () => {
    const ch = new Channel({ maxBufferCount: 3 });
    for (let i = 0; i < 5; i++) ch.publish(`m${i}`); // seq 1..5, buffer retains 3, 4, 5
    const miss = ch.replayAfter(`${ch.epoch}-1`); // event 2 has been evicted
    expect(miss.hit).toBe(false);
    const hit = ch.replayAfter(`${ch.epoch}-3`);
    expect(hit.hit).toBe(true);
    expect(hit.events.map((e) => e.id)).toEqual([`${ch.epoch}-4`, `${ch.epoch}-5`]);
  });

  it("按字节上限淘汰最旧事件", () => {
    const ch = new Channel({ maxBufferBytes: 30 });
    ch.publish("a".repeat(20));
    ch.publish("b".repeat(20)); // event 1 was evicted due to the byte cap
    expect(ch.replayAfter(`${ch.epoch}-0`).hit).toBe(false); // a subscriber that never saw event 1 needs a resync
    const hit = ch.replayAfter(`${ch.epoch}-1`); // has seen event 1 (its eviction doesn't matter) -> hit, replays 2
    expect(hit.hit).toBe(true);
    expect(hit.events.map((e) => e.id)).toEqual([`${ch.epoch}-2`]);
  });

  it("Last-Event-ID 等于最新 id → 命中且无补发；超过已分配 seq → miss", () => {
    const ch = new Channel();
    ch.publish("x"); // seq 1
    const same = ch.replayAfter(`${ch.epoch}-1`);
    expect(same.hit).toBe(true);
    expect(same.events).toEqual([]);
    expect(ch.replayAfter(`${ch.epoch}-99`).hit).toBe(false);
  });

  it("跨纪元（通道回收重建 / 进程重启）一律 miss——即使 seq 落在命中区间", () => {
    const ch = new Channel();
    for (let i = 0; i < 5; i++) ch.publish(`m${i}`); // seq 1..5, all within the buffer
    // Same seq, different epoch: the old implementation would false-hit on integer ranges; now it must miss -> resync.
    expect(ch.replayAfter(`${foreignEpoch(ch)}-2`).hit).toBe(false);
    expect(ch.replayAfter(`${ch.epoch}-2`).hit).toBe(true);
  });

  it("非法 Last-Event-ID（无纪元 / 非整数 seq）→ miss", () => {
    const ch = new Channel();
    ch.publish("x");
    expect(ch.replayAfter("42").hit).toBe(false); // legacy pure-integer ids are also treated as unknown
    expect(ch.replayAfter("").hit).toBe(false);
    expect(ch.replayAfter(`${ch.epoch}-abc`).hit).toBe(false);
    expect(ch.replayAfter("-1").hit).toBe(false);
  });

  it("全新通道（无事件）带任何 Last-Event-ID → miss；`<epoch>-0` 从头命中", () => {
    const ch = new Channel();
    expect(ch.replayAfter(`${ch.epoch}-5`).hit).toBe(false);
    expect(ch.replayAfter(`${ch.epoch}-0`).hit).toBe(true); // 0 = from the start, hits since nothing was evicted (no events to replay)
  });

  it("sendTo 私发：占用 seq、不进缓冲、不广播", () => {
    const ch = new Channel();
    const broadcast: ChannelEvent[] = [];
    const priv: ChannelEvent[] = [];
    ch.subscribe((e) => broadcast.push(e));
    const evt = ch.sendTo((e) => priv.push(e), { type: "hello" }, "server_event");
    expect(evt.id).toBe(`${ch.epoch}-1`);
    expect(priv).toHaveLength(1);
    expect(broadcast).toHaveLength(0);
    const next = ch.publish("x");
    expect(next.id).toBe(`${ch.epoch}-2`); // the seq number was consumed by the private send
    expect(ch.replayAfter(`${ch.epoch}-1`).events.map((e) => e.id)).toEqual([`${ch.epoch}-2`]); // private sends bypass the buffer
  });

  it("hub：同 key 复用通道；空闲超时回收、有订阅者不回收", () => {
    const hub = new ChannelHub({ idleMs: 1000 });
    const ch = hub.get("s1");
    expect(hub.get("s1")).toBe(ch);
    ch.publish("x");
    const now = Date.now();
    hub.sweep(now + 500);
    expect(hub.peek("s1")).toBe(ch);
    hub.sweep(now + 2000);
    expect(hub.peek("s1")).toBeUndefined();

    const ch2 = hub.get("s2");
    ch2.subscribe(() => {});
    hub.sweep(Date.now() + 10_000);
    expect(hub.peek("s2")).toBe(ch2); // not reclaimed while it has a subscriber
    hub.dispose();
  });

  it("hub：isActive 谓词命中的通道不回收（运行中等待审批无 publish 也保留）", () => {
    const active = new Set(["busy"]);
    const hub = new ChannelHub({ idleMs: 1000, isActive: (key) => active.has(key) });
    const busy = hub.get("busy");
    const idle = hub.get("idle");
    busy.publish("x");
    idle.publish("x");
    const now = Date.now();
    hub.sweep(now + 10_000);
    expect(hub.peek("busy")).toBe(busy); // active: reclamation is skipped
    expect(hub.peek("idle")).toBeUndefined();
    // Once back to idle, it's reclaimed under the normal rule.
    active.clear();
    hub.sweep(now + 20_000);
    expect(hub.peek("busy")).toBeUndefined();
    hub.dispose();
  });
});

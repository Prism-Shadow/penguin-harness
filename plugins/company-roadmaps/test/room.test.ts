/**
 * The room is read, never written: a channel's configuration and its day files, by a cursor
 * that crosses days and never steps back.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentMembers,
  endCursor,
  readRoom,
  readSince,
  recentMessages,
} from "../src/index.js";
import { orgDir, post, tempRoot, writeChannel } from "./fakes.js";

describe("the room's configuration", () => {
  it("reads the members and the archived flag from channel.toml, in the channel's order", async () => {
    const root = await tempRoot();
    await writeChannel(root, "room_a", ["user:boss", "agent:acme_web", "agent:acme_dev"]);
    const room = await readRoom(orgDir(root), "room_a");
    expect(room).toMatchObject({ archived: false });
    expect(agentMembers(room!)).toEqual(["acme_web", "acme_dev"]);
    await writeChannel(root, "room_b", [], { archived: true });
    expect((await readRoom(orgDir(root), "room_b"))?.archived).toBe(true);
  });

  it("is null for a channel that is not there, and for a name that is not a channel id", async () => {
    const root = await tempRoot();
    expect(await readRoom(orgDir(root), "nowhere")).toBeNull();
    expect(await readRoom(orgDir(root), "../escape")).toBeNull();
  });
});

describe("the messages", () => {
  it("reads nothing from the end, then exactly what was posted after it", async () => {
    const root = await tempRoot();
    await post(root, "room_a", "user:boss", "before");
    const start = await endCursor(orgDir(root), "room_a");
    expect((await readSince(orgDir(root), "room_a", start)).messages).toEqual([]);
    await post(root, "room_a", "agent:acme_dev", "after");
    const { messages, cursor } = await readSince(orgDir(root), "room_a", start);
    expect(messages.map((m) => [m.sender, m.text, m.hop])).toEqual([["agent:acme_dev", "after", 1]]);
    expect((await readSince(orgDir(root), "room_a", cursor)).messages).toEqual([]);
  });

  it("carries on into the next day's file", async () => {
    const root = await tempRoot();
    await post(root, "room_a", "user:boss", "monday", { date: "2026-09-28" });
    const start = await endCursor(orgDir(root), "room_a");
    await post(root, "room_a", "user:boss", "still monday", { date: "2026-09-28" });
    await post(root, "room_a", "user:boss", "tuesday", { date: "2026-09-29" });
    const { messages, cursor } = await readSince(orgDir(root), "room_a", start);
    expect(messages.map((m) => m.text)).toEqual(["still monday", "tuesday"]);
    expect(cursor).toEqual({ date: "2026-09-29", line: 1 });
  });

  it("leaves a line still being written for the next read, and skips a bad one", async () => {
    const root = await tempRoot();
    const file = path.join(orgDir(root), "channels", "room_a", "2026-09-27.jsonl");
    await post(root, "room_a", "user:boss", "one");
    await fs.appendFile(file, "{broken\n");
    await fs.appendFile(file, '{"id":"msg-x","time":"t","sender":"user:boss","hop":0,"text":"half');
    const first = await readSince(orgDir(root), "room_a", { date: "0000-00-00", line: 0 });
    expect(first.messages.map((m) => m.text)).toEqual(["one"]);
    expect(first.skipped).toBe(1);
    await fs.appendFile(file, '","mentions":[]}\n');
    const second = await readSince(orgDir(root), "room_a", first.cursor);
    expect(second.messages.map((m) => m.text)).toEqual(["half"]);
  });

  it("never steps back when a day file shrinks", async () => {
    const root = await tempRoot();
    await post(root, "room_a", "user:boss", "a");
    await post(root, "room_a", "user:boss", "b");
    const end = await endCursor(orgDir(root), "room_a");
    const file = path.join(orgDir(root), "channels", "room_a", "2026-09-27.jsonl");
    const [first] = (await fs.readFile(file, "utf8")).split("\n");
    await fs.writeFile(file, `${first}\n`);
    const { messages, cursor } = await readSince(orgDir(root), "room_a", end);
    expect(messages).toEqual([]);
    expect(cursor).toEqual(end);
  });

  it("gives a new room session the last messages of the latest days, oldest first", async () => {
    const root = await tempRoot();
    await post(root, "room_a", "user:boss", "d1", { date: "2026-09-26" });
    await post(root, "room_a", "user:boss", "d2a", { date: "2026-09-27" });
    await post(root, "room_a", "user:boss", "d2b", { date: "2026-09-27" });
    const recent = await recentMessages(orgDir(root), "room_a", 2);
    expect(recent.map((m) => m.text)).toEqual(["d2a", "d2b"]);
    const all = await recentMessages(orgDir(root), "room_a", 20);
    expect(all.map((m) => m.text)).toEqual(["d1", "d2a", "d2b"]);
  });
});

/** The room is read, never written: a channel's configuration. */
import { describe, expect, it } from "vitest";
import { agentMembers, readRoom } from "../src/index.js";
import { orgDir, tempRoot, writeChannel } from "./fakes.js";

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

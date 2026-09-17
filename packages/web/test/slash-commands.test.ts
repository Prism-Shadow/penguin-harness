/**
 * The slash menu's built-in commands per composer state (src/features/chat/slash-commands.ts):
 * a draft offers only what a first send can act on, a live Session offers every command its
 * host supports, and a subagent child offers none (its menu lists skills alone).
 */
import { describe, expect, it } from "vitest";
import { builtinSlashCommands } from "../src/features/chat/slash-commands";

const everything = { compact: true, switchModel: true, handoff: true };
const nothing = { compact: false, switchModel: false, handoff: false };

describe("builtinSlashCommands", () => {
  it("a live Session lists every supported command, in menu order", () => {
    expect(builtinSlashCommands("session", everything)).toEqual([
      "/compact",
      "/goal",
      "/model",
      "/agent",
    ]);
  });

  it("a live Session drops a command whose handler or candidates are missing", () => {
    expect(builtinSlashCommands("session", { ...everything, compact: false })).toEqual([
      "/goal",
      "/model",
      "/agent",
    ]);
    expect(builtinSlashCommands("session", { ...everything, switchModel: false })).toEqual([
      "/compact",
      "/goal",
      "/agent",
    ]);
    expect(builtinSlashCommands("session", { ...everything, handoff: false })).toEqual([
      "/compact",
      "/goal",
      "/model",
    ]);
  });

  it("a draft has no Session to compact, fork or hand over: only /goal, whatever the host passes", () => {
    expect(builtinSlashCommands("draft", everything)).toEqual(["/goal"]);
    expect(builtinSlashCommands("draft", nothing)).toEqual(["/goal"]);
  });

  it("a subagent child lists no built-in command", () => {
    expect(builtinSlashCommands("subagent", everything)).toEqual([]);
    expect(builtinSlashCommands("subagent", nothing)).toEqual([]);
  });
});

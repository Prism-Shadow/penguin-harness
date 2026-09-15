/**
 * profile-form.ts: what the Profile page's nickname buttons write, and when they are live.
 *
 * The page's other half — a picked image applying without a Save — is a React effect of the
 * pick handler and this package's vitest is node-only (`environment: "node"`, no jsdom), so it
 * is not reachable from here; what IS reachable is the rule that decides the two nickname
 * writes, which is the half a regression would land on silently.
 */
import { describe, expect, it } from "vitest";
import type { UserInfo } from "@prismshadow/penguin-server/api";
import { profileControls } from "../src/lib/profile-form";

/** An account with nothing set: the state every account predating the Profile page is in. */
const bare: UserInfo = {
  userId: "bob",
  isAdmin: false,
  passwordIsInitial: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const named: UserInfo = { ...bare, displayName: "Bob Loblaw" };

describe("profileControls", () => {
  it("stores the trimmed text, and spells a blank box as null rather than an empty name", () => {
    // null is the route's "clear it": a blank string would be refused as a 1-32 character name,
    // so a field the user emptied has to leave as null or the save 400s.
    expect(profileControls(named, "  Bob  ").nicknameToStore).toBe("Bob");
    expect(profileControls(named, "   ").nicknameToStore).toBe(null);
  });

  it("keeps Save dead until the box would store something else", () => {
    expect(profileControls(named, "Bob Loblaw").canSaveNickname).toBe(false);
    // Whitespace either side is not an edit: the server trims too, so saving it would write
    // the value that is already there.
    expect(profileControls(named, "  Bob Loblaw  ").canSaveNickname).toBe(false);
    expect(profileControls(named, "Bob").canSaveNickname).toBe(true);
    // Emptying the field is a change — it stores null — while an already-blank one is not.
    expect(profileControls(named, "").canSaveNickname).toBe(true);
    expect(profileControls(bare, "").canSaveNickname).toBe(false);
    expect(profileControls(bare, "Bob").canSaveNickname).toBe(true);
  });

  it("restores the default by writing null, and only when there is something stored", () => {
    // Restore default is a write like Save, not a clear of the input box: with a nickname
    // stored it must reach the server, and with none stored the button has nothing to do
    // because every surface already falls back to the user id.
    expect(profileControls(named, "anything typed").canRestoreNickname).toBe(true);
    expect(profileControls(bare, "anything typed").canRestoreNickname).toBe(false);
  });

  it("reads the avatar's Restore default off what is stored, not off the typed nickname", () => {
    expect(profileControls(bare, "Bob").canRestoreAvatar).toBe(false);
    expect(
      profileControls({ ...bare, avatar: "data:image/png;base64,AAAA" }, "").canRestoreAvatar,
    ).toBe(true);
  });
});

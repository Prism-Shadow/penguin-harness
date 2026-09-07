/**
 * The palette's host commands: rendered from what the host offers, in the words it sent.
 *
 * The host is a separate program on its own schedule — a desktop shell reaches users through
 * an installer, this page through a hot push — so it can offer a command the page has never
 * heard of. That case is the reason the exchange exists: a page that could only show what it
 * already carried would learn nothing from asking. (Reading absent words also threw inside
 * the actions useMemo and blanked the whole App, which is how this was found.)
 */
import { describe, expect, it } from "vitest";
import type { HostCommandOffer } from "@prismshadow/penguin-server/api";
import { HOST_COMMANDS } from "@prismshadow/penguin-server/api";
import { hostCommandActions } from "../src/features/palette/app-palette";
import { S } from "../src/lib/strings";

const offer = (command: string, label = "", labelZh = ""): HostCommandOffer => ({
  command,
  label,
  labelZh,
});

describe("hostCommandActions", () => {
  it("has its own words for every command this build declares", () => {
    const actions = hostCommandActions(
      HOST_COMMANDS.map((c) => offer(c)),
      "en",
    );
    expect(actions.map((a) => a.command)).toEqual([...HOST_COMMANDS]);
    // Its own, not the host's: these offers carry no words at all.
    expect(actions.map((a) => a.action.label())).toEqual([
      S.commandPalette.installCli,
      S.commandPalette.checkUpdates,
      S.commandPalette.openDevTools,
    ]);
  });

  it("renders a command it has never heard of, in the host's words", () => {
    const [action, ...rest] = hostCommandActions(
      [offer("reveal-log-folder", "Reveal the log folder", "打开日志目录")],
      "en",
    );
    expect(rest).toEqual([]);
    expect(action?.command).toBe("reveal-log-folder");
    expect(action?.action.label()).toBe("Reveal the log folder");
    // The id is search terms, so typing either half finds it.
    expect(action?.action.keywords).toEqual(["reveal", "log", "folder"]);
  });

  it("takes the host's Chinese when the page is in Chinese, and falls back either way", () => {
    const offers = [offer("reveal-log-folder", "Reveal the log folder", "打开日志目录")];
    expect(hostCommandActions(offers, "zh")[0]?.action.label()).toBe("打开日志目录");
    // A host with only one language: it is shown whichever way the page is set.
    expect(hostCommandActions([offer("x", "Only English")], "zh")[0]?.action.label()).toBe(
      "Only English",
    );
  });

  it("keeps this build's own words for a command it knows, whatever the host called it", () => {
    const actions = hostCommandActions(
      [offer("open-devtools", "DevTools (host wording)", "宿主写的词")],
      "zh",
    );
    expect(actions[0]?.action.label()).toBe(S.commandPalette.openDevTools);
    // And with them the search terms, which a host does not send.
    expect(actions[0]?.action.keywords).toContain("console");
  });

  it("skips an id with no words from a host too old to send any", () => {
    // Only such a host sends bare ids, and it has nothing to offer this build lacks words for.
    expect(hostCommandActions([offer("some-command-from-the-future")], "en")).toEqual([]);
  });
});

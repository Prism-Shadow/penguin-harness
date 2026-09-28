/**
 * The page a played preview is served as.
 *
 * Two things have to hold. What the player is told about the activity must reach it intact,
 * whatever an author put in a title. And the page must know when its link runs out: every
 * picture and sound it fetches rides on that link, so past it the activity would otherwise
 * break a file at a time and look faulty rather than expired. And the page reports its
 * state to the App that opened it, and only to that App.
 */
import { describe, expect, it } from "vitest";
import {
  PLAYER_SOURCE,
  playerPage,
  type PlayerPageInput,
} from "../src/activities/sandbox-player.js";

const input: PlayerPageInput = {
  base: "/preview/activity/token/",
  title: "Jobs",
  moduleId: "r2pt01",
  productCode: "r2pt01",
  refNum: 156,
  hasAssessment: false,
  resolution: "1024x768",
  languageCode: "en-US",
  startSceneId: null,
  expiresAt: 1_790_000_000_000,
  parentOrigin: "http://localhost:7364",
};

function configuration(html: string): Record<string, unknown> {
  const match = /<script type="application\/json" id="penguin-sandbox">([\s\S]*?)<\/script>/.exec(
    html,
  );
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

describe("the page a played preview is served as", () => {
  it("tells the player the activity and when its link expires", () => {
    const html = playerPage(input);
    expect(configuration(html)).toMatchObject({ refNum: 156, expiresAt: 1_790_000_000_000 });
    expect(html).toContain('id="playerExpired"');
    expect(html).toContain('src="/preview/activity/token/player/player.js"');
  });

  it("keeps a title that looks like markup from ending the configuration early", () => {
    const html = playerPage({ ...input, title: "</script><script>alert(1)</script>" });
    expect(configuration(html).title).toBe("</script><script>alert(1)</script>");
    expect(html).toContain("<title>&lt;/script&gt;");
  });

  it("tells the player which App origin it may report to", () => {
    expect(configuration(playerPage(input)).parentOrigin).toBe("http://localhost:7364");
    expect(configuration(playerPage({ ...input, parentOrigin: null })).parentOrigin).toBeNull();
  });
});

describe("the player's inspector bridge", () => {
  it("posts state only to the configured App origin, never to a wildcard", () => {
    expect(PLAYER_SOURCE).toContain("window.parent.postMessage(");
    expect(PLAYER_SOURCE).toContain("sandbox.parentOrigin\n");
    expect(PLAYER_SOURCE).not.toMatch(/postMessage\([^)]*['"]\*['"]/);
  });

  it("stays silent without an App origin, and takes highlights only from that App", () => {
    expect(PLAYER_SOURCE).toContain(
      "if (!detail || !sandbox.parentOrigin || window.parent === window) return;",
    );
    expect(PLAYER_SOURCE).toContain(
      "if (!sandbox.parentOrigin || event.source !== window.parent || event.origin !== sandbox.parentOrigin) return;",
    );
  });

  it("picks only while the App has switched picking on, and swallows the tap it picks", () => {
    expect(PLAYER_SOURCE).toContain("picking = data.on === true;");
    expect(PLAYER_SOURCE).toContain("if (!picking) return;");
    expect(PLAYER_SOURCE).toContain("event.stopImmediatePropagation();");
    // Pick mode arrives through the same gate as a highlight: this window's parent, at the
    // configured origin, and nothing else.
    expect(PLAYER_SOURCE).toContain(
      "if (!data || (data.type !== HIGHLIGHT_MESSAGE && data.type !== PICK_MODE_MESSAGE)) return;",
    );
  });

  it("picks inside the activity only, reporting every id out to it, nearest first", () => {
    // The navbar's pause button is not an asset; a click outside the activity keeps picking.
    expect(PLAYER_SOURCE).toContain(
      "if (!target || !activity || !activity.contains(target) || target === activity) return;",
    );
    expect(PLAYER_SOURCE).toContain(
      "for (let node = target; node && node !== activity && ids.length < 8; node = node.parentElement)",
    );
    expect(PLAYER_SOURCE).toContain(
      "{ type: PICKED_MESSAGE, id: ids[0] || null, ids: ids, interactableId: interactableId }",
    );
  });
});

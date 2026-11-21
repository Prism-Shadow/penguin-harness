/**
 * What counts as a change of page for the theme's page transition (web-app/page-transitions.ts),
 * over a page table shaped like the app's: the chat page with its optional session, the Agents
 * list and an Agent's own page, company mode's one page with its own sub-routes, home for every
 * other path, and the terminal outside the shell.
 *
 * - Given the chat page, sending a draft's first message, switching conversations and opening a
 *   new chat stay on it.
 * - Given company mode, moving between its own sub-routes stays on its one page.
 * - Given two different shell pages, moving between them is a page change, the Agents list and
 *   an Agent's page included.
 * - Given a bare page, leaving the shell for it is not one: there is no shell to keep live.
 */
import { describe, expect, it } from "vitest";
import { isPageChange } from "../src/web-app/page-transitions";

const PAGES = [
  { id: "chat", path: "/chat/:sessionId?", frame: "shell" },
  { id: "agents", path: "/agents", frame: "shell" },
  { id: "agent", path: "/agents/:agentId", frame: "shell" },
  { id: "models", path: "/models", frame: "shell" },
  { id: "org", path: "/org/*", frame: "shell" },
  { id: "home", path: "*", frame: "shell" },
  { id: "terminal", path: "/terminal", frame: "bare" },
] as const;

const change = (from: string, to: string) => isPageChange(PAGES, from, to);

describe("a change of page", () => {
  it("is not sending a draft, switching conversations or opening a new chat", () => {
    expect(change("/chat/new", "/chat/session-1")).toBe(false);
    expect(change("/chat/session-1", "/chat/session-2")).toBe(false);
    expect(change("/chat/session-2", "/chat/new")).toBe(false);
    expect(change("/chat", "/chat/session-1")).toBe(false);
  });

  it("is not a move between company mode's own sub-routes", () => {
    expect(change("/org/acme/desk", "/org/acme/channels/all")).toBe(false);
  });

  it("is a move between two shell pages", () => {
    expect(change("/agents", "/models")).toBe(true);
    expect(change("/chat/session-1", "/agents")).toBe(true);
    expect(change("/agents", "/agents/docs-expert")).toBe(true);
    expect(change("/models", "/org/acme/desk")).toBe(true);
  });

  it("is not leaving the shell for a bare page, nor staying on the same path", () => {
    expect(change("/agents", "/terminal")).toBe(false);
    expect(change("/models", "/models")).toBe(false);
  });
});

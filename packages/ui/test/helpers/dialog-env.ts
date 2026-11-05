/**
 * What a portaled overlay needs to render once in Node: a `document` whose body the portal
 * targets, and an `HTMLElement` for the focus-restore read a dialog makes during render. A suite
 * pairs it with `createPortal` mocked to render in place, since the server renderer refuses
 * portals:
 *
 *   vi.mock("react-dom", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("react-dom")>()),
 *     createPortal: (node: ReactNode) => node,
 *   }));
 *
 * Only the markup is reachable this way; effects never run under the static renderer.
 */
import { afterAll, vi } from "vitest";

export function stubDialogGlobals(): void {
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  afterAll(() => {
    vi.unstubAllGlobals();
  });
}

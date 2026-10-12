/**
 * A frame embedded in another page is that page's guest until the reader clicks into it.
 *
 * - Given an embedded frame the reader has not entered, when the app focuses an element, then
 *   nothing takes focus; when it scrolls an element into view, then nothing scrolls; when the
 *   wheel turns over it, then the page scrolls by the wheel's amount and the frame does not.
 * - Given the reader has clicked into the frame, then focus and scrolling are the app's again,
 *   a focus still never scrolls the page, and the wheel is left to the frame.
 * - Given a zoom gesture, or a page of another origin, then the wheel is left to the browser.
 *
 * The window is faked at its edge: its document's focus, its parent, its prototypes and its
 * event registration; the real Chromium behaviour is checked on the landing page itself.
 */
import { describe, expect, it } from "vitest";
import { installGuestFrame } from "../src/app/guest-frame";
import type { GuestWindow } from "../src/app/guest-frame";

interface Fake {
  win: GuestWindow;
  focused: { value: boolean };
  focusCalls: Array<FocusOptions | undefined>;
  intoViewCalls: number;
  pageScrolls: ScrollToOptions[];
  wheel: (init: Partial<WheelEvent>) => { prevented: boolean };
}

function fakeWindow(opts: { crossOrigin?: boolean } = {}): Fake {
  const focused = { value: false };
  const focusCalls: Array<FocusOptions | undefined> = [];
  const pageScrolls: ScrollToOptions[] = [];
  let intoViewCalls = 0;
  let listener: ((event: WheelEvent) => void) | null = null;
  const fake: Fake = {
    focused,
    focusCalls,
    get intoViewCalls() {
      return intoViewCalls;
    },
    pageScrolls,
    win: {
      document: { hasFocus: () => focused.value },
      parent: {
        innerHeight: 900,
        scrollBy: ((options: ScrollToOptions) => {
          if (opts.crossOrigin) throw new DOMException("Blocked a frame", "SecurityError");
          pageScrolls.push(options);
        }) as Window["scrollBy"],
      },
      HTMLElement: {
        prototype: { focus: (options?: FocusOptions) => void focusCalls.push(options) },
      },
      Element: { prototype: { scrollIntoView: () => void (intoViewCalls += 1) } },
      addEventListener: (_type, l) => {
        listener = l;
      },
    },
    wheel: (init) => {
      let prevented = false;
      listener!({
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
        ...init,
        preventDefault: () => {
          prevented = true;
        },
      } as WheelEvent);
      return { prevented };
    },
  };
  return fake;
}

describe("an embedded frame", () => {
  it("takes no focus and scrolls nothing until the reader has clicked into it", () => {
    const f = fakeWindow();
    installGuestFrame(f.win);
    f.win.HTMLElement.prototype.focus();
    f.win.Element.prototype.scrollIntoView({ block: "nearest" });
    expect(f.focusCalls).toEqual([]);
    expect(f.intoViewCalls).toBe(0);
  });

  it("hands the wheel to the page, in pixels whatever unit the wheel reports", () => {
    const f = fakeWindow();
    installGuestFrame(f.win);
    expect(f.wheel({ deltaY: 120 })).toEqual({ prevented: true });
    expect(f.wheel({ deltaY: 3, deltaMode: 1 })).toEqual({ prevented: true });
    expect(f.wheel({ deltaY: 1, deltaMode: 2 })).toEqual({ prevented: true });
    expect(f.pageScrolls).toEqual([
      { left: 0, top: 120, behavior: "instant" },
      { left: 0, top: 48, behavior: "instant" },
      { left: 0, top: 900, behavior: "instant" },
    ]);
  });

  it("is the app's own once the reader is inside: focus works without scrolling, the wheel stays in the frame", () => {
    const f = fakeWindow();
    installGuestFrame(f.win);
    f.focused.value = true;
    f.win.HTMLElement.prototype.focus({ focusVisible: true } as FocusOptions);
    f.win.Element.prototype.scrollIntoView();
    expect(f.focusCalls).toEqual([{ focusVisible: true, preventScroll: true }]);
    expect(f.intoViewCalls).toBe(1);
    expect(f.wheel({ deltaY: 120 })).toEqual({ prevented: false });
    expect(f.pageScrolls).toEqual([]);
  });

  it("leaves a zoom gesture, and a page it cannot reach, to the browser", () => {
    const zoom = fakeWindow();
    installGuestFrame(zoom.win);
    expect(zoom.wheel({ deltaY: 40, ctrlKey: true })).toEqual({ prevented: false });
    expect(zoom.pageScrolls).toEqual([]);
    const foreign = fakeWindow({ crossOrigin: true });
    installGuestFrame(foreign.win);
    expect(foreign.wheel({ deltaY: 120 })).toEqual({ prevented: false });
  });
});

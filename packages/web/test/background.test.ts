/** @vitest-environment jsdom */
/**
 * Background settings, through the same provider and controls the Appearance page uses.
 *
 * - Given a saved picture, changing display, alignment and transparency survives a remount.
 * - Given a saved picture, removing it restores the plain background and stays removed on reload.
 * - Given refused storage writes, changing or removing the background preserves the saved state and reports why.
 * - Given damaged settings or unsafe image data, opening Appearance uses safe defaults without writing.
 * - Given blocked storage, Appearance still opens without a custom background.
 * - Given a non-image or an oversized file, choosing it preserves the existing picture and reports the supported format.
 * - Given a decoder failure, choosing a picture releases the temporary URL and keeps the existing background.
 * - Given a valid image, choosing it stores a locally encoded image and reveals the controls.
 */
import { AppShell } from "@prismshadow/penguin-ui";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundControls } from "../src/features/settings/background-controls";
import {
  BACKGROUND_IMAGE_KEY,
  BACKGROUND_SETTINGS_KEY,
  BackgroundProvider,
  backgroundStyle,
  useBackground,
} from "../src/state/background";
import { S } from "../src/lib/strings";
import { button, click, field, mount, pickFile, type, unmountAll, waitFor } from "./helpers/dom";
import { blockedStorage, stubLocalStorage } from "./helpers/storage";

const picture = "data:image/png;base64,aW1hZ2U=";
const nextPicture = "data:image/webp;base64,bmV3aW1hZ2U=";
function Appearance() {
  const { image, settings } = useBackground();
  return h(AppShell, {
    nav: "Navigation",
    background: image === null ? undefined : backgroundStyle(image, settings),
    children: h(BackgroundControls),
  });
}
const wallpaper = () => document.querySelector<HTMLElement>(".ui-shell > [data-wallpaper-layer]");
const render = () => mount(h(BackgroundProvider, null, h(Appearance)));

function storedPicture(settings?: string) {
  const store = stubLocalStorage();
  store.setItem(BACKGROUND_IMAGE_KEY, picture);
  if (settings !== undefined) store.setItem(BACKGROUND_SETTINGS_KEY, settings);
  return store;
}
async function select(label: string, value: string) {
  await click(button(label));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === value,
  )!;
  await click(option);
}
const photoInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe("background choices", () => {
  it("keeps display, alignment and transparency after reopening", async () => {
    storedPicture();
    const page = await render();
    for (const mode of ["contain", "original", "tile", "cover"] as const) {
      await select(S.settings.background.mode, S.settings.background.modes[mode]);
      expect(wallpaper()?.style.backgroundRepeat).toBe(mode === "tile" ? "repeat" : "no-repeat");
      expect(wallpaper()?.style.backgroundSize).toBe(
        ["tile", "original"].includes(mode) ? "auto" : mode,
      );
    }
    await select(S.settings.background.mode, S.settings.background.modes.tile);
    await select(S.settings.background.position, S.settings.background.positions["right bottom"]);
    await type(field(S.settings.background.transparency), "35");
    expect(wallpaper()?.style.opacity).toBe("0.65");
    await page.unmount();
    await render();
    expect(wallpaper()?.style.backgroundImage).toContain(picture);
    expect(wallpaper()?.style.backgroundRepeat).toBe("repeat");
    expect(wallpaper()?.style.backgroundPosition).toBe("right bottom");
    expect(field(S.settings.background.transparency).value).toBe("35");
  });

  it("restores the plain background and keeps the picture removed on reload", async () => {
    storedPicture();
    const page = await render();
    await click(button(S.settings.background.remove));
    expect(wallpaper()).toBeNull();
    expect(document.querySelector('input[type="range"]')).toBeNull();
    await page.unmount();
    await render();
    expect(wallpaper()).toBeNull();
    expect(button(S.settings.background.choose)).toBeDefined();
  });

  it("preserves the image and controls when storage refuses a change", async () => {
    const store = storedPicture();
    await render();
    vi.spyOn(store, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(store, "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    await type(field(S.settings.background.transparency), "10");
    expect(field(S.settings.background.transparency).value).toBe("80");
    await click(button(S.settings.background.remove));
    expect(wallpaper()?.style.backgroundImage).toContain(picture);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      S.settings.background.storageError,
    );
  });

  it.each([
    "{broken",
    "null",
    JSON.stringify({ mode: "invalid", position: "invalid", transparency: "invalid" }),
    JSON.stringify({ transparency: 200 }),
  ])("opens safely with damaged settings %s", async (settings) => {
    const store = storedPicture(settings);
    store.setItem(BACKGROUND_IMAGE_KEY, "https://example.com/tracker.png");
    const writes = vi.spyOn(store, "setItem");
    await render();
    expect(wallpaper()).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });

  it("opens when local storage is blocked", async () => {
    stubLocalStorage(blockedStorage());
    await render();
    expect(button(S.settings.background.choose)).toBeDefined();
    expect(wallpaper()).toBeNull();
  });

  it.each(["wrong-type", "too-large"])(
    "rejects a %s file without replacing the image",
    async (kind) => {
      storedPicture();
      await render();
      const file = new File(["image"], "image.png", {
        type: kind === "wrong-type" ? "text/plain" : "image/png",
      });
      if (kind === "too-large") Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
      await pickFile(photoInput(), file);
      expect(wallpaper()?.style.backgroundImage).toContain(picture);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        S.settings.background.fileError,
      );
    },
  );

  it("releases a failed image decode and retains the current background", async () => {
    storedPicture();
    const release = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:failed", revokeObjectURL: release });
    vi.stubGlobal(
      "Image",
      class {
        decode = () => Promise.reject(new Error("Broken image"));
      },
    );
    await render();
    await pickFile(photoInput(), new File(["broken"], "photo.png", { type: "image/png" }));
    await waitFor(() => document.querySelector('[role="alert"]') !== null);
    expect(release).toHaveBeenCalledWith("blob:failed");
    expect(wallpaper()?.style.backgroundImage).toContain(picture);
  });

  it("encodes a chosen picture locally and reveals the controls", async () => {
    const store = stubLocalStorage();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:photo", revokeObjectURL: vi.fn() });
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 4000;
        naturalHeight = 2000;
        decode = () => Promise.resolve();
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(nextPicture);
    await render();
    await pickFile(photoInput(), new File(["picture"], "photo.png", { type: "image/png" }));
    await waitFor(() => wallpaper() !== null);
    expect(store.getItem(BACKGROUND_IMAGE_KEY)).toBe(nextPicture);
    expect(document.querySelector('[role="img"]')).not.toBeNull();
    expect(field(S.settings.background.transparency).value).toBe("80");
  });
});

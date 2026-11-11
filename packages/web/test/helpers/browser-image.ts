/**
 * The browser's image boundary, faked for jsdom, which decodes no image and draws no canvas: an
 * `Image` that decodes or fails as the test says — through `decode()`, and through the `onload` /
 * `onerror` its `src` assignment fires — blob URLs that are made for a picked file and let go,
 * and, when the test names an encoding, a canvas that draws nothing and encodes to it.
 *
 * Call it in a test or a `beforeEach`; the config's `unstubGlobals` puts `Image` and `URL` back
 * after each test, and the caller's `vi.restoreAllMocks()` the canvas.
 */
import { vi } from "vitest";

export interface BrowserImageOptions {
  /** Whether a picked file decodes as an image. */
  decodes?: boolean;
  /** The decoded image's natural size. */
  width?: number;
  height?: number;
  /** What the canvas encodes a drawn image as; omitted, the canvas is left alone. */
  encoded?: string;
  /** The blob URL a picked file is given. */
  blobUrl?: string;
}

export interface BrowserImageFake {
  /** The blob URLs let go, in order. */
  readonly revoked: readonly string[];
}

export function fakeBrowserImage(options: BrowserImageOptions = {}): BrowserImageFake {
  const { decodes = true, width = 640, height = 480, encoded, blobUrl = "blob:picked" } = options;
  const revoked: string[] = [];

  class FakeImage {
    naturalWidth = decodes ? width : 0;
    naturalHeight = decodes ? height : 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private current = "";
    get src(): string {
      return this.current;
    }
    set src(value: string) {
      this.current = value;
      queueMicrotask(() => (decodes ? this.onload?.() : this.onerror?.()));
    }
    decode(): Promise<void> {
      return decodes ? Promise.resolve() : Promise.reject(new Error("Broken image"));
    }
  }
  vi.stubGlobal("Image", FakeImage);

  // A URL still parses: only the blob-URL statics are the fake's.
  class FakeURL extends URL {
    static override createObjectURL(): string {
      return blobUrl;
    }
    static override revokeObjectURL(url: string): void {
      revoked.push(url);
    }
  }
  vi.stubGlobal("URL", FakeURL);

  if (encoded !== undefined) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(encoded);
  }

  return { revoked };
}

/**
 * A screenshot of the page, taken by the page itself: the visible DOM is serialized into an
 * SVG `foreignObject`, the browser draws that SVG, and the bitmap comes back as a PNG data
 * URL. No new dependency and no capture permission — the browser renders the page it is
 * showing, which is the same pixels the person sees.
 *
 * What that costs: images and fonts referenced by a *relative* URL do not resolve inside the
 * generated document (its base URL is the data URL), so same-origin `<img>` sources are
 * inlined first and webfonts fall back to the system stack. The clip is the viewport: the
 * clone is sized to `innerWidth × innerHeight`, which is what the Agent asks for ("what does
 * the screen look like").
 *
 * What it must never show: a password box's contents. The value of an `input[type=password]`
 * is never read (see dom.ts), the clone carries no value attribute of its own, and the field
 * is painted as a flat mask so even its length is not visible. The bridge's own overlays
 * (the picker, the chat window) are removed from the clone.
 */
import { OVERLAY_ATTRIBUTE } from "./dom";

/** One capture: the PNG (or JPEG, if a PNG would be unreasonably large) and its size. */
export interface ScreenshotResult {
  dataUrl: string;
  width: number;
  height: number;
  /** What the page could not reproduce (relative images, fonts), for the caller to pass on. */
  notes: string[];
}

/** Ceiling on the encoded data URL; above it the capture is re-encoded as JPEG. */
const MAX_DATA_URL_CHARS = 12_000_000;

/** Every stylesheet the page can read, flattened into one text block. */
function stylesheetText(): string {
  const chunks: string[] = [];
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
  for (const sheet of sheets) {
    try {
      for (const rule of sheet.cssRules) chunks.push(rule.cssText);
    } catch {
      // A cross-origin sheet cannot be read; its rules would not have applied inside the
      // generated document either.
    }
  }
  return chunks.join("\n");
}

/** Rewrites same-origin `<img>` sources as data URLs, so the clone needs no network. */
async function inlineImages(root: Element, notes: string[]): Promise<void> {
  const images = [...root.querySelectorAll("img[src]")];
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (src === "" || src.startsWith("data:")) return;
      try {
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", dataUrl);
      } catch {
        img.removeAttribute("src");
        if (!notes.includes("images")) notes.push("images");
      }
    }),
  );
}

/** Copies what the person typed into the clone; passwords are masked, never copied. */
function copyFormState(source: Element, target: Element): void {
  const from = source.querySelectorAll("input, textarea, select");
  const to = target.querySelectorAll("input, textarea, select");
  const count = Math.min(from.length, to.length);
  for (let i = 0; i < count; i += 1) {
    const original = from[i];
    const copy = to[i];
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      if (original.type === "password") {
        copy.removeAttribute("value");
        copy.setAttribute(
          "style",
          `${copy.getAttribute("style") ?? ""};background:#8a8a8a;color:transparent;border-color:#8a8a8a`,
        );
        continue;
      }
      if (original.type === "checkbox" || original.type === "radio") {
        if (original.checked) copy.setAttribute("checked", "");
        else copy.removeAttribute("checked");
        continue;
      }
      if (original.value !== "") copy.setAttribute("value", original.value);
      continue;
    }
    if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
      copy.textContent = original.value;
      continue;
    }
    if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
      const options = [...copy.options];
      options.forEach((option, index) => {
        if (original.options[index]?.selected === true) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      });
    }
  }
}

/** Frames the clone at the viewport, removes what must not be drawn, and inlines its assets. */
async function prepareClone(notes: string[]): Promise<HTMLElement> {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(`[${OVERLAY_ATTRIBUTE}], script, noscript, link[rel=preload], template`)
    .forEach((node) => {
      node.remove();
    });
  // A framed document is not rendered inside a foreignObject; a hatched box says "a frame was
  // here" without pretending to be its content.
  for (const frame of [...clone.querySelectorAll("iframe, webview")]) {
    const box = document.createElement("div");
    box.setAttribute(
      "style",
      "width:100%;height:100%;min-height:120px;background:repeating-linear-gradient(45deg,#e4e4e7,#e4e4e7 8px,#f4f4f5 8px,#f4f4f5 16px)",
    );
    frame.replaceWith(box);
  }
  copyFormState(document.documentElement, clone);
  await inlineImages(clone, notes);
  const style = document.createElement("style");
  // An entry animation restarts in the generated document: `.anim-fade` (and the toast, dock
  // and page fades built the same way) is `animation: … both`, so its first frame is the one
  // drawn — an empty pane where the conversation is. The clone is a still picture; it renders
  // each element at its resting state.
  style.textContent =
    "*, *::before, *::after { animation: none !important; transition: none !important; }\n" +
    stylesheetText();
  (clone.querySelector("head") ?? clone).appendChild(style);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${window.innerWidth}px`;
  clone.style.height = `${window.innerHeight}px`;
  clone.style.overflow = "hidden";
  return clone;
}

/** Draws one serialized document at the viewport size. */
async function draw(dataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("the page's own markup could not be drawn"));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  const background = getComputedStyle(document.body).backgroundColor;
  context.fillStyle = background === "rgba(0, 0, 0, 0)" ? "#ffffff" : background;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

/** Captures the viewport as a data URL, falling back to JPEG when the PNG is too large to ship. */
export async function captureScreenshot(): Promise<ScreenshotResult> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width === 0 || height === 0) throw new Error("the page has no viewport to capture");
  const notes: string[] = [];
  const clone = await prepareClone(notes);
  const html = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${html}</foreignObject></svg>`;
  const canvas = await draw(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
  );
  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    notes.push("jpeg");
  }
  return { dataUrl, width, height, notes };
}

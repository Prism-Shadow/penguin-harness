/**
 * The framed app's contract with the gallery — pure, so it is unit-tested.
 *
 * A framed app is its own document (`app.html`): its own root for the theme attributes, its own
 * storage, its own router. The gallery drives it through the URL alone:
 *
 *   app.html?route=/chat/s-1&theme=modern&mode=dark&accent=neutral&size=m&latin=theme&cjk=theme&lang=zh
 *
 * Inside the document, an inline script that runs before anything else replaces
 * `localStorage` (and `sessionStorage`) with an in-memory store seeded from those params under
 * the app's own storage keys — the same keys the app's pre-paint boot script and its theme,
 * locale and sidebar state read. So the app boots exactly as it does for a user who chose those
 * preferences, three frames of one page can each show a different theme without fighting over
 * the shared origin storage, and what the app writes (a preference changed in its Settings, a
 * collapsed sidebar) stays in that frame.
 */
import { THEME_STORAGE_KEYS } from "../../../ui/src/boot";

/** The frame's document, relative to the gallery's base. */
export const APP_FRAME_PATH = "/app.html";

/**
 * The window the app is framed at: a common laptop viewport, and the narrowest one where the
 * app shows its full sidebar beside a roomy chat column. The page scales it to the column.
 */
export const APP_FRAME = { width: 1280, height: 800 } as const;
/** The phone frame: an iPhone-class viewport, a plain frame with no device art. */
export const PHONE_FRAME = { width: 390, height: 844 } as const;

/**
 * The app's language preference key (`state/locale.tsx`). The theme keys are the package's;
 * this one is the app's own and has no export, so it is spelled here and pinned by a test.
 */
export const APP_LANG_KEY = "penguin.lang";

/** Frame URL param → the app storage key the seeding script writes it to. */
export const SEEDED_KEYS: Readonly<Record<string, string>> = {
  theme: THEME_STORAGE_KEYS.themeId,
  mode: THEME_STORAGE_KEYS.mode,
  accent: THEME_STORAGE_KEYS.accent,
  size: THEME_STORAGE_KEYS.textSize,
  latin: THEME_STORAGE_KEYS.fontLatin,
  cjk: THEME_STORAGE_KEYS.fontCjk,
  lang: APP_LANG_KEY,
};

/** What the gallery tells a frame, besides the app route. */
export interface FramePrefs {
  theme: string;
  mode: string;
  accent: string;
  size: string;
  latin: string;
  cjk: string;
  lang: "en" | "zh";
}

export interface FrameTarget {
  /** The app route to open on. */
  route: string;
  /** Start signed out (the login surface). */
  signedOut?: boolean;
  /** A dialog to open once the app is up. */
  open?: string;
}

/** The frame's URL: the document, then the target and the preferences as query params. */
export function appFrameSrc(base: string, prefs: FramePrefs, target: FrameTarget): string {
  const params = new URLSearchParams();
  params.set("route", target.route);
  for (const key of Object.keys(SEEDED_KEYS)) params.set(key, prefs[key as keyof FramePrefs]);
  if (target.signedOut) params.set("auth", "out");
  if (target.open) params.set("open", target.open);
  return `${base}${APP_FRAME_PATH}?${params.toString()}`;
}

export interface FrameParams extends FrameTarget {
  lang: "en" | "zh";
}

/** What a frame document reads back from its own URL. An absent route opens the chat. */
export function parseFrameParams(search: string): FrameParams {
  const params = new URLSearchParams(search);
  const route = params.get("route");
  const open = params.get("open");
  return {
    route: route && route.startsWith("/") ? route : "/chat",
    lang: params.get("lang") === "zh" ? "zh" : "en",
    ...(params.get("auth") === "out" ? { signedOut: true } : {}),
    ...(open ? { open } : {}),
  };
}

/**
 * The inline script that gives the frame document its own storage, seeded from the URL. A
 * classic, dependency-free IIFE, generated from `SEEDED_KEYS` so the keys can never drift from
 * the app's. It must run before the app's boot script, which reads the same storage.
 */
export function storageSeedScript(): string {
  return (
    "(function(){" +
    "function store(seed){var m=seed;return{" +
    "getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null}," +
    "setItem:function(k,v){m[k]=String(v)}," +
    "removeItem:function(k){delete m[k]}," +
    "clear:function(){m={}}," +
    "key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null}," +
    "get length(){return Object.keys(m).length}}}" +
    `var S=${JSON.stringify(SEEDED_KEYS)},q=new URLSearchParams(location.search),seed={};` +
    "for(var p in S){var v=q.get(p);if(v)seed[S[p]]=v}" +
    'Object.defineProperty(window,"localStorage",{value:store(seed),configurable:true});' +
    'Object.defineProperty(window,"sessionStorage",{value:store({}),configurable:true});' +
    "})()"
  );
}

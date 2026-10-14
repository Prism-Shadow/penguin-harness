/** Local wallpaper preferences. Image bytes are stored separately so a slider writes only settings. */
import { createContext, useContext, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export const BACKGROUND_IMAGE_KEY = "penguin.background.image";
export const BACKGROUND_SETTINGS_KEY = "penguin.background.settings";
export const BACKGROUND_MODES = ["cover", "contain", "tile", "original"] as const;
export const BACKGROUND_POSITIONS = [
  "left top",
  "center top",
  "right top",
  "left center",
  "center center",
  "right center",
  "left bottom",
  "center bottom",
  "right bottom",
] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number];
export interface BackgroundSettings {
  transparency: number;
  mode: BackgroundMode;
  position: BackgroundPosition;
}
const DEFAULT_SETTINGS: BackgroundSettings = {
  transparency: 80,
  mode: "cover",
  position: "center center",
};

/** Only locally encoded raster data is allowed into a CSS image value. */
export function isBackgroundImage(value: unknown): value is string {
  return (
    typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  );
}

function readBackground(): { image: string | null; settings: BackgroundSettings } {
  let image: string | null = null;
  let settings = DEFAULT_SETTINGS;
  try {
    const storedImage = localStorage.getItem(BACKGROUND_IMAGE_KEY);
    if (isBackgroundImage(storedImage)) image = storedImage;
    const stored: unknown = JSON.parse(localStorage.getItem(BACKGROUND_SETTINGS_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      const value = stored as Partial<BackgroundSettings>;
      settings = {
        transparency:
          typeof value.transparency === "number" && Number.isFinite(value.transparency)
            ? Math.min(100, Math.max(0, value.transparency))
            : DEFAULT_SETTINGS.transparency,
        mode: BACKGROUND_MODES.find((mode) => mode === value.mode) ?? DEFAULT_SETTINGS.mode,
        position:
          BACKGROUND_POSITIONS.find((position) => position === value.position) ??
          DEFAULT_SETTINGS.position,
      };
    }
  } catch {
    // Blocked storage or an incomplete settings value must not prevent the app from opening.
  }
  return { image, settings };
}

export function backgroundStyle(image: string | null, settings: BackgroundSettings): CSSProperties {
  return {
    backgroundImage: image === null ? "none" : `url("${image}")`,
    backgroundSize:
      settings.mode === "tile" || settings.mode === "original" ? "auto" : settings.mode,
    backgroundRepeat: settings.mode === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: settings.position,
    opacity: 1 - settings.transparency / 100,
  };
}

interface BackgroundContextValue {
  image: string | null;
  settings: BackgroundSettings;
  setImage: (image: string | null) => void;
  setSettings: (settings: BackgroundSettings) => void;
}
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readBackground);
  const [image, setImageState] = useState(initial.image);
  const [settings, setSettingsState] = useState(initial.settings);

  return (
    <BackgroundContext.Provider
      value={{
        image,
        settings,
        setImage: (next) => {
          if (next === null) localStorage.removeItem(BACKGROUND_IMAGE_KEY);
          else {
            if (!isBackgroundImage(next)) throw new Error("Invalid background image");
            localStorage.setItem(BACKGROUND_IMAGE_KEY, next);
          }
          // A failed write leaves both the current image and the current controls untouched.
          setImageState(next);
        },
        setSettings: (next) => {
          localStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
          setSettingsState(next);
        },
      }}
    >
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (!context) throw new Error("useBackground must be used within a BackgroundProvider");
  return context;
}

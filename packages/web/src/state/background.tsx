/**
 * Wallpaper preferences, which follow the account: the image and its display settings are
 * cached in this browser (the pre-paint script paints from the cache) and written through
 * lib/account-sync, which carries an edit to the account and has this provider read the cache
 * again when the account's copy arrives. Image bytes are stored separately so a slider writes
 * only settings.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BACKGROUND_STORAGE_KEYS,
  backgroundLayerStyle,
  isBackgroundImage,
  readBackground,
} from "@prismshadow/penguin-ui/boot";
import type { BackgroundSettings } from "@prismshadow/penguin-ui/boot";
import { subscribeAccountApplied, writeCached } from "../lib/account-sync/cache";

// The keys, the vocabulary and the reader are the shared package's (`@prismshadow/penguin-ui/boot`):
// the pre-paint script reads the same store, so a reload paints the image from the first frame.
export {
  BACKGROUND_MODES,
  BACKGROUND_POSITIONS,
  isBackgroundImage,
} from "@prismshadow/penguin-ui/boot";
export type {
  BackgroundMode,
  BackgroundPosition,
  BackgroundSettings,
} from "@prismshadow/penguin-ui/boot";

export const BACKGROUND_IMAGE_KEY = BACKGROUND_STORAGE_KEYS.image;
export const BACKGROUND_SETTINGS_KEY = BACKGROUND_STORAGE_KEYS.settings;

export function backgroundStyle(image: string | null, settings: BackgroundSettings): CSSProperties {
  return backgroundLayerStyle(image, settings);
}

/** The stored background; storage that cannot even be reached reads as none. */
function storedBackground(): ReturnType<typeof readBackground> {
  try {
    return readBackground(localStorage);
  } catch {
    return readBackground({ getItem: () => null });
  }
}

interface BackgroundContextValue {
  image: string | null;
  settings: BackgroundSettings;
  setImage: (image: string | null) => void;
  setSettings: (settings: BackgroundSettings) => void;
}
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(storedBackground);
  const [image, setImageState] = useState(initial.image);
  const [settings, setSettingsState] = useState(initial.settings);

  // The account's background replaced the cached one at sign-in.
  useEffect(
    () =>
      subscribeAccountApplied(() => {
        const next = storedBackground();
        setImageState(next.image);
        setSettingsState(next.settings);
      }),
    [],
  );

  return (
    <BackgroundContext.Provider
      value={{
        image,
        settings,
        setImage: (next) => {
          if (next !== null && !isBackgroundImage(next)) {
            throw new Error("Invalid background image");
          }
          writeCached(BACKGROUND_IMAGE_KEY, next);
          // A failed write leaves both the current image and the current controls untouched.
          setImageState(next);
        },
        setSettings: (next) => {
          writeCached(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
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

/** Landing entry point: mounts the React root component. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

/** When the page last reloaded itself for a missing chunk (session storage, epoch ms). */
const CHUNK_RELOAD_KEY = "penguin-landing.chunk-reload";

/**
 * A post opens with chunks loaded on demand, and a deploy replaces every chunk name: a tab opened
 * before the deploy asks for files that are gone. Load the page afresh instead of leaving it blank;
 * the new shell names the new chunks. Not twice in a row: a failure right after such a reload is
 * the network, and reloading again would loop.
 */
window.addEventListener("vite:preloadError", () => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // No storage, no loop guard: leave the page as it is.
    return;
  }
  window.location.reload();
});

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

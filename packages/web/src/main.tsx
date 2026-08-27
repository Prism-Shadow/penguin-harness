/**
 * Frontend entry point: mounts the React root component (the frontend SPA is only
 * responsible for rendering and interaction).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
// KaTeX's stylesheet and its woff2 faces, resolved out of node_modules so Vite emits them as local
// assets: the desktop app has to render math with no network, and a CDN <link> would leave every
// formula as unstyled markup offline. Imported before styles.css so the app's own `.katex` rules
// (CJK fallback, error state, wide-formula scrolling) come later in the cascade and win.
import "katex/dist/katex.min.css";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Frontend entry point: mounts the React root component (the frontend SPA is only
 * responsible for rendering and interaction).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { captureHomeOrigin } from "./lib/machines";
import "./styles.css";

// Before the router: a machine switch arrives with ?penguinHome=<origin>, and the login
// redirect would drop the query before any component saw it.
captureHomeOrigin();

const container = document.getElementById("root");
if (!container) throw new Error("#root mount point not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * The Web App's implementations, handed to the face plugin web halves import
 * (`@prismshadow/penguin-web-plugin`). Imported for its effect: by the composition root before
 * the module tree boots (web-root.ts), and by a test that drives a plugin web half's calls. It
 * sits in the frame's module, which may reach a feature through its index (the dock's
 * operations); the libraries may not.
 *
 * Everything handed over is the app's own module — the same `apiFetch`, the same toast, the same
 * dock store — so a plugin's request goes through this app's transport, and a suite's socket
 * stand-in or the gallery's network swap catches it like any of the app's.
 */
import { webLocale } from "@prismshadow/penguin-web-plugin";
import { provideWebHost } from "@prismshadow/penguin-web-plugin/host";
import { ApiError, apiFetch } from "../api/client";
import { apiErrorText } from "../lib/api-error";
import { failureNode, failureOf } from "../lib/failure";
import {
  formatBytes,
  formatDateTime,
  formatRelativeLong,
  formatRelativeShort,
} from "../lib/format";
import { requestSettingsPage } from "../lib/settings-request";
import { toastApiError } from "../lib/toast-api-error";
import { toneDot, toneInk, toneSurface } from "../lib/tone";
import { currentDockScope, isTabShown, openPanel } from "@prismshadow/penguin-library-session/web";
import { isOpenPageDrag } from "../lib/page-layout";

provideWebHost({
  ApiError,
  apiFetch,
  apiErrorText,
  failureOf,
  failureNode,
  toastApiError,
  requestSettings: requestSettingsPage,
  openPanel,
  isTabShown,
  currentDockScope,
  isOpenPageDrag,
  formatDateTime,
  // In the language on screen, which the face is told of with every dictionary switch.
  formatRelativeShort: (iso) => formatRelativeShort(iso, webLocale()),
  formatRelativeLong: (iso) => formatRelativeLong(iso, webLocale()),
  formatBytes,
  toneInk,
  toneSurface,
  toneDot,
});

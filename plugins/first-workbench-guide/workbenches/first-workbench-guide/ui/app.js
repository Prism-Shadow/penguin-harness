// A bookmarked guide asset opens its original Agent and machine in the product shell.
import { appUrl } from "./guide-url.js";
const target = appUrl("first-workbench-guide");
if (target) {
  if (window.self === window.top) location.replace(target);
  else {
    const link = document.getElementById("guide");
    link.href = target;
    link.hidden = false;
  }
}

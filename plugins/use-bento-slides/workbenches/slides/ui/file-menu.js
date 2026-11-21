// The editor lives in another frame, so clicks there never bubble to this document.
export function setupFileMenu(trigger, menu) {
  const items = () => Array.from(menu.querySelectorAll('[role="menuitem"]:not(:disabled)'));

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  function open(last = false) {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    items()
      .at(last ? -1 : 0)
      ?.focus();
  }

  trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open(event.key === "ArrowUp");
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Tab") return close(true); // Let Tab continue from the trigger.
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    const choices = items();
    const position = choices.indexOf(document.activeElement);
    let next;
    switch (event.key) {
      case "ArrowDown":
        next = (position + 1) % choices.length;
        break;
      case "ArrowUp":
        next = (position + choices.length - 1) % choices.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = choices.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    choices[next]?.focus();
  });

  // Close before an action opens its dialog, so closing the dialog restores focus to File.
  menu.addEventListener(
    "click",
    (event) => {
      if (event.target.closest('[role="menuitem"]')) close(true);
    },
    true,
  );
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && !trigger.contains(event.target)) close();
  });
  document.addEventListener("focusin", (event) => {
    if (!menu.contains(event.target) && event.target !== trigger) close();
  });
  window.addEventListener("blur", () => close());
}

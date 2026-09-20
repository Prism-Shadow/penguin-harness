/** Clipboard writes with a transient "copied" flag for the button that asked. */
import { useCallback, useEffect, useRef, useState } from "react";

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through: an insecure origin or a denied permission still has execCommand.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/** `[copiedKey, copy]`: `copiedKey` names the last thing copied for 1.2 s, so one hook serves many buttons. */
export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((key: string, text: string) => {
    void copyText(text).then(() => {
      setCopied(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1200);
    });
  }, []);
  return [copied, copy];
}

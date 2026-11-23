/** Motion and replay work only while their content is on screen and the tab is visible. */
import { useEffect, useRef, useState } from "react";

export function useVisibleActivity<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = !("IntersectionObserver" in window);
    const update = () => setActive(visible && !document.hidden);
    const observer = visible
      ? null
      : new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting === true;
          update();
        });
    observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return { ref, active };
}

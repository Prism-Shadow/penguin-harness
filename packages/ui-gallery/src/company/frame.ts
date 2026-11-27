import { useEffect, useState } from "react";
import { LOCATION_MESSAGE, NAVIGATE_MESSAGE } from "../../../web/src/lib/frame-messages";

export type Lang = "zh" | "en";

export const ROUTES = ["/", "/new"] as const;
export type Route = (typeof ROUTES)[number];

export function langOf(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function routeOf(at: string): Route {
  const path = at.split("?")[0] ?? "/";
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : "/";
}

function framed(): boolean {
  return window.parent !== window;
}

function startLang(): Lang {
  const asked = new URLSearchParams(window.location.search).get("lang");
  return langOf(framed() || asked === null ? document.documentElement.lang : asked);
}

export function useHostLang(): Lang {
  const [lang, setLang] = useState<Lang>(startLang);
  useEffect(() => {
    if (!framed()) return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setLang(langOf(root.lang)));
    observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
    setLang(langOf(root.lang));
    return () => observer.disconnect();
  }, []);
  return lang;
}

function startAt(): string {
  const hash = window.location.hash.slice(1);
  return hash.startsWith("/") ? hash : "/";
}

export function useHostRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeOf(startAt()));
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; at?: unknown } | null;
      if (data?.type === LOCATION_MESSAGE && typeof data.at === "string")
        setRoute(routeOf(data.at));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const go = (next: Route) => {
    setRoute(next);
    if (framed())
      window.parent.postMessage({ type: LOCATION_MESSAGE, at: next }, window.location.origin);
    else window.history.replaceState(null, "", `${window.location.search}#${next}`);
  };
  return [route, go];
}

export function navigateHost(to: string): void {
  if (framed()) window.parent.postMessage({ type: NAVIGATE_MESSAGE, to }, window.location.origin);
}
